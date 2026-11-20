"""
Extrai os balancetes do ano e gera o CSV usado pelas Demonstrações
(dados/demonstracoes/balancetes.csv): Empresa;Período;Conta contábil;Montante.
Depois, gere o arquivo de carga do Supabase com: python scripts/preparar_dados_supabase.py --a-partir AAAA-MM

Lê dois formatos, na mesma pasta:
  1. EMPRESA_BP_DRE_MM_AAAA.xlsx (arquivos de BP/DRE do grupo) — código SAP pelo nome do arquivo (CODIGOS).
  2. Relatório comparativo do SAP (ex.: tic_mês_10_e_9.XLSX), com as colunas
     Empresa | Item de balanço/DRE | Nº conta | Texto item… | <mês> | <mês anterior> | Desvio absoluto.
     O código vem da coluna Empresa; o mês (dia 1 no SAP) vira o último dia do mês. Linhas sem
     Nº conta (subtotais) são ignoradas. Vários arquivos da mesma empresa são juntados.

Lê a aba de balancete de cada arquivo ("Balancete AAAA" ou "Balancetes_Acumulado AAAA"), localizando
a coluna da conta ("Conta razão" ou "CtaRazão") e as colunas de mês pelo cabeçalho. Funciona com os três
modelos de arquivo do grupo (MetrôBH; Trivia/Engetrens/Solidum/Expertisea/VDMG; Ductu/BRTrens/Trilha).

Uso (na raiz do projeto, Python 3 com openpyxl):
    python scripts/extrair_balancetes_xlsx.py PASTA_COM_OS_XLSX ANO [--integrar]

    Sem --integrar: gera scripts/saida/balancetes_ANO.csv.
    Com --integrar: além disso, substitui no balancetes.csv do projeto as linhas do ANO das empresas lidas
                    (os demais anos e empresas ficam como estão).

Regras:
  - Saldos acumulados (como no balancete), arredondados a centavos.
  - Por empresa, entram só as contas com saldo em algum mês do ano, em todos os meses a partir do
    primeiro ao último mês com saldo (meses futuros vazios ou zerados ficam de fora).
  - Confere se cada mês fecha (soma dos saldos = 0) e avisa contas sem classificação no projeto.
  - O código SAP vem de CODIGOS abaixo (pelo início do nome do arquivo).
"""

import csv
import datetime
import re
import sys
from pathlib import Path

import openpyxl

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "dados" / "demonstracoes"   # fontes das demonstrações (não publicadas no site)
SAIDA = Path(__file__).resolve().parent / "saida"

# Início do nome do arquivo -> código SAP da empresa (empresas.csv)
CODIGOS = {
    "VDMG": "3600",
    "Trilha": "3700",
    "MetroBH": "4029",
    "TICTrens": "4032",
    "Trivia": "4034",
    "Engetrens": "6018",
    "DuctuTrens": "6019",
    "Solidum": "6022",
    "BRTrens": "6023",
    "Expertisea": "6024",
}


def ler_balancete(caminho, ano):
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    abas = [f"Balancete {ano}", f"Balancetes_Acumulado {ano}"]
    aba = next((a for a in abas if a in wb.sheetnames), None)
    if not aba:
        raise ValueError(f"nenhuma aba {abas} em {caminho.name}")
    linhas = list(wb[aba].iter_rows(values_only=True))
    rotulo = lambda v: str(v).strip().lower() if v is not None else ""
    hi = next(i for i, r in enumerate(linhas) if any(rotulo(v) in ("conta razão", "ctarazão") for v in r))
    cab = linhas[hi]
    i_conta = next(i for i, v in enumerate(cab) if rotulo(v) in ("conta razão", "ctarazão"))
    meses = {i: v.date() for i, v in enumerate(cab) if isinstance(v, datetime.datetime) and v.year == ano}
    saldos, invalidos = {}, []
    for n, r in enumerate(linhas[hi + 1:], start=hi + 2):
        conta = str(r[i_conta]).strip() if r[i_conta] is not None else ""
        if not re.fullmatch(r"\d{8}", conta):
            continue
        for i, dia in meses.items():
            v = r[i] if i < len(r) else None
            if isinstance(v, (int, float)):
                saldos[(conta, dia)] = saldos.get((conta, dia), 0.0) + v
            elif v not in (None, ""):
                invalidos.append(f"linha {n}, {dia:%m/%Y}: {v!r}")
    return aba, saldos, invalidos


def ler_comparativo_sap(caminho, ano):
    """Relatório comparativo do SAP. Devolve {codigo_empresa: {(conta, último dia do mês): saldo}}."""
    ws = openpyxl.load_workbook(caminho, read_only=True, data_only=True).worksheets[0]
    linhas = list(ws.iter_rows(values_only=True))
    if not linhas:
        return None
    cab = [str(v).strip().lower() if v is not None else "" for v in linhas[0]]
    if "empresa" not in cab or "nº conta" not in cab:
        return None
    i_emp, i_conta = cab.index("empresa"), cab.index("nº conta")
    meses = {}
    for i, v in enumerate(linhas[0]):
        if isinstance(v, datetime.datetime) and v.year == ano:
            proximo = datetime.date(v.year + (v.month == 12), v.month % 12 + 1, 1)
            meses[i] = proximo - datetime.timedelta(days=1)
    por_empresa = {}
    for r in linhas[1:]:
        conta = str(r[i_conta]).strip() if r[i_conta] is not None else ""
        codigo = str(r[i_emp]).strip() if r[i_emp] is not None else ""
        if not re.fullmatch(r"\d{8}", conta) or not codigo:
            continue                                   # subtotal (sem conta)
        saldos = por_empresa.setdefault(codigo, {})
        for i, dia in meses.items():
            v = r[i] if isinstance(r[i], (int, float)) else 0.0
            if (conta, dia) in saldos and abs(saldos[(conta, dia)] - v) > 0.005:
                raise ValueError(f"{caminho.name}: {conta} {dia:%m/%Y} difere de outro arquivo ({saldos[(conta, dia)]} x {v})")
            saldos[(conta, dia)] = v
    return por_empresa


def formatar(v):
    """1234.5 -> '1234,5' (padrão dos CSVs do portal: vírgula decimal, sem separador de milhar)."""
    v = round(v, 2)
    if v == 0:
        return "0"
    t = f"{v:.2f}".rstrip("0").rstrip(".")
    return t.replace(".", ",")


def linhas_da_empresa(codigo, saldos):
    com_valor = [d for (c, d), v in saldos.items() if abs(v) >= 0.005]
    if not com_valor:
        return []
    # Do primeiro ao último mês com algum saldo (meses futuros preenchidos com zero ficam de fora)
    primeiro, ultimo = min(com_valor), max(com_valor)
    preenchidos = {d for (c, d), v in saldos.items()}
    meses = sorted(d for d in preenchidos if primeiro <= d <= ultimo)
    contas = sorted({c for (c, d), v in saldos.items() if abs(v) >= 0.005})
    return [[codigo, f"{d:%d/%m/%Y}", c, formatar(saldos.get((c, d), 0.0))] for d in meses for c in contas]


def gravar(caminho, linhas):
    with open(caminho, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";", lineterminator="\r\n")
        w.writerow(["Empresa", "Período", "Conta contábil", "Montante"])
        w.writerows(linhas)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    pasta, ano, integrar = Path(sys.argv[1]), int(sys.argv[2]), "--integrar" in sys.argv
    classificadas = set()
    if (DADOS / "classificacao.csv").exists():
        with open(DADOS / "classificacao.csv", encoding="utf-8-sig", newline="") as f:
            classificadas = {r[0].strip() for r in list(csv.reader(f, delimiter=";"))[1:] if r}

    todas, empresas, pendentes = [], set(), []
    lidos = []   # (rótulo, código, origem, saldos)
    for arq in sorted(pasta.glob("*_BP_DRE_*.xlsx")):
        prefixo = arq.name.split("_BP_DRE")[0]
        codigo = CODIGOS.get(prefixo)
        if not codigo:
            pendentes.append(prefixo)
            print(f"{prefixo:11} IGNORADO: sem código SAP em CODIGOS.")
            continue
        aba, saldos, invalidos = ler_balancete(arq, ano)
        lidos.append((prefixo, codigo, aba, saldos, invalidos))

    # Relatórios comparativos do SAP (qualquer outro .xlsx da pasta), juntando os arquivos de cada empresa
    sap = {}
    for arq in sorted(p for p in pasta.iterdir() if p.suffix.lower() == ".xlsx" and "_BP_DRE_" not in p.name):
        try:
            por_empresa = ler_comparativo_sap(arq, ano)
        except ValueError as erro:
            raise SystemExit(f"Erro: {erro}")
        for codigo, saldos in (por_empresa or {}).items():
            destino = sap.setdefault(codigo, ({}, []))
            for chave, v in saldos.items():
                if chave in destino[0] and abs(destino[0][chave] - v) > 0.005:
                    raise SystemExit(f"Erro: {arq.name}: {chave[0]} {chave[1]:%m/%Y} difere de outro arquivo")
                destino[0][chave] = v
            destino[1].append(arq.name)
    for codigo, (saldos, arquivos) in sorted(sap.items()):
        if codigo in {c for _, c, *_ in lidos}:
            raise SystemExit(f"Erro: empresa {codigo} veio nos dois formatos; deixe só um na pasta.")
        nome = next((k for k, v in CODIGOS.items() if v == codigo), codigo)
        lidos.append((nome, codigo, f"SAP ({len(arquivos)} arquivo(s))", saldos, []))

    for prefixo, codigo, aba, saldos, invalidos in lidos:
        linhas = linhas_da_empresa(codigo, saldos)
        todas += linhas
        empresas.add(codigo)
        meses = sorted({l[1][3:] for l in linhas}, key=lambda m: m[3:] + m[:2])
        contas = {l[2] for l in linhas}
        sem_cls = sorted(contas - classificadas) if classificadas else []
        print(f"{prefixo:11} {codigo} | {aba:26} | {len(contas):4} contas | {meses[0] if meses else '-'} a {meses[-1] if meses else '-'} | {len(linhas):5} linhas"
              + (f" | {len(sem_cls)} sem classificação" if sem_cls else ""))
        for d in sorted({d for (c, d) in saldos}):
            soma = sum(v for (c, dd), v in saldos.items() if dd == d)
            if abs(soma) > 0.05:
                print(f"            ⚠ {d:%m/%Y} não fecha: soma dos saldos = {soma:,.2f}")
        for i in invalidos[:5]:
            print(f"            ⚠ valor não numérico: {i}")

    SAIDA.mkdir(exist_ok=True)
    destino = SAIDA / f"balancetes_{ano}.csv"
    gravar(destino, todas)
    print(f"\n{len(todas)} linhas em {destino.relative_to(RAIZ)}")

    if integrar:
        alvo = DADOS / "balancetes.csv"
        with open(alvo, encoding="utf-8-sig", newline="") as f:
            atuais = [r for r in list(csv.reader(f, delimiter=";"))[1:] if any(v.strip() for v in r)]
        mantidas = [r for r in atuais if not (r[0] in empresas and r[1][-4:] == str(ano))]
        gravar(alvo, mantidas + todas)
        print(f"Projeto atualizado: {alvo.relative_to(RAIZ)} ({len(mantidas)} linhas mantidas + {len(todas)} de {ano})")
    if pendentes:
        print(f"Sem código SAP (não incluídas): {', '.join(pendentes)}")


if __name__ == "__main__":
    main()
