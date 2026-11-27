"""
Prepara os CSVs das demonstrações para importar no Supabase (Table Editor > Import data from CSV).

Os CSVs do portal usam ";" como separador, datas dd/mm/aaaa e números com vírgula decimal.
O importador do Supabase espera "," como separador, datas aaaa-mm-dd, ponto decimal e cabeçalho
com os nomes das colunas das tabelas (supabase/03_demonstracoes.sql e 04_comentarios_revisao.sql).

Uso (na raiz do projeto, só Python 3, sem instalar nada):
    python scripts/preparar_dados_supabase.py                    carga completa (todas as tabelas)
    python scripts/preparar_dados_supabase.py --a-partir 2026-11 rotina mensal: só os saldos a partir do mês

Gera em scripts/saida/, nesta ordem de importação:
    1. empresas.csv              (id_empresa = código SAP)
    2. balancetes_classificacoes.csv        (linhas das demonstrações, com id_classificacao já numerado)
    3. balancetes_contas.csv      (plano de contas único, ligado a id_classificacao)
    4. balancetes.csv            (ligado por id_empresa e numero_conta)
    5. balancetes_comentarios.csv  (comentários antigos, com o id_colab de cada autor)
Depois da importação, rode supabase/05_apos_importacao.sql.

Antes de gerar, o script confere as ligações: empresa ou conta inexistente, conta classificada numa
linha que não existe na hierarquia, linha repetida. Qualquer problema interrompe com a lista do que corrigir.

Comentários: o CSV antigo só tem o nome do autor. Na primeira execução o script cria
scripts/autores_comentarios.csv com os nomes; preencha o id_colab de cada um (tabela colaboradores)
e rode de novo. Os demais arquivos são gerados mesmo assim.

Carga mensal de balancetes: basta rodar de novo e importar só as linhas do mês novo
(ou filtrar o balancetes.csv do SAP antes). Importe na tabela balancetes_pendencias (script 22): o que tiver
conta cadastrada vai direto para balancetes; as contas novas ficam como pendência em Configurações › Plano de contas.
"""

import csv
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ORIGEM = RAIZ / "dados" / "demonstracoes"   # CSVs de origem (não publicados no site)
SAIDA = Path(__file__).resolve().parent / "saida"
AUTORES = Path(__file__).resolve().parent / "autores_comentarios.csv"


class ErroDados(Exception):
    pass


# ---------- conversões ----------

def texto(v):
    return (v or "").strip()


def nivel(v):
    """'(vazio)' e vazio viram ''."""
    t = texto(v)
    return "" if t in ("", "(vazio)") else t


def numero(v):
    """'1.234,56' -> '1234.56'; vazio -> ''"""
    t = texto(v)
    if not t:
        return ""
    if not re.fullmatch(r"[+-]?(\d+|\d{1,3}(\.\d{3})+)(,\d+)?", t):
        raise ValueError(f"número inválido: {t!r}")
    return t.replace(".", "").replace(",", ".")


def data(v):
    """'31/01/2026' -> '2026-01-31' (aceita também aaaa-mm-dd)"""
    t = texto(v)
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", t)
    if m:
        return f"{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}"
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return m[0]
    raise ValueError(f"data inválida: {t!r}")


def data_hora(v):
    """'05/11/2026 11:29:12' -> '2026-11-05T11:29:12-03:00' (horário de Brasília)"""
    t = texto(v)
    if not t:
        return ""
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?", t)
    if not m:
        raise ValueError(f"data/hora inválida: {t!r}")
    return f"{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}T{int(m[4]):02d}:{m[5]}:{m[6] or '00'}-03:00"


# ---------- leitura e gravação ----------

def ler(arquivo):
    """Lê um CSV do portal e devolve (cabeçalho, linhas não vazias) com o número da linha original."""
    caminho = ORIGEM / arquivo
    if not caminho.exists():
        raise ErroDados(f"{arquivo} não encontrado em {ORIGEM.relative_to(RAIZ)}.")
    with open(caminho, encoding="utf-8-sig", newline="") as f:
        linhas = list(csv.reader(f, delimiter=";"))
    cab = [c.strip() for c in linhas[0]]
    dados = []
    for n, l in enumerate(linhas[1:], start=2):
        if any(v.strip() for v in l):
            dados.append((n, dict(zip(cab, l + [""] * (len(cab) - len(l))))))
    return cab, dados


def exigir(arquivo, cab, colunas):
    faltando = [c for c in colunas if c not in cab]
    if faltando:
        raise ErroDados(f"{arquivo}: coluna(s) {faltando} não encontrada(s). Cabeçalho: {cab}")


def gravar(nome, cabecalho, linhas):
    saida = SAIDA / nome
    with open(saida, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(cabecalho)
        w.writerows(linhas)
    print(f"  {nome:26} {len(linhas):>6} linhas")


def resumir(itens, limite=15):
    itens = list(itens)
    extra = f" … e mais {len(itens) - limite}" if len(itens) > limite else ""
    return "\n    ".join(itens[:limite]) + extra


# ---------- tabelas ----------

def preparar_empresas():
    cab, dados = ler("empresas.csv")
    exigir("empresas.csv", cab, ["Empresa", "Nome", "metodo_consolidacao", "percentual_participacao", "classificacao"])
    saida, codigos, nomes, posicoes = [], set(), {}, set()
    for n, l in dados:
        codigo = texto(l["Empresa"])
        if not codigo.isdigit():
            raise ErroDados(f"empresas.csv, linha {n}: código {codigo!r} não é numérico.")
        if codigo in codigos:
            raise ErroDados(f"empresas.csv, linha {n}: empresa {codigo} repetida.")
        codigos.add(codigo)
        nomes[texto(l["Nome"]).lower()] = codigo
        metodo = texto(l["metodo_consolidacao"]).lower()
        if metodo not in ("integral", "proporcional", "fora"):
            raise ErroDados(f"empresas.csv, linha {n}: metodo_consolidacao deve ser integral, proporcional ou fora (veio {metodo!r}).")
        try:
            perc = numero(l["percentual_participacao"]) or "100"
        except ValueError as erro:
            raise ErroDados(f"empresas.csv, linha {n}: percentual_participacao {erro}")
        if not 0 <= float(perc) <= 100:
            raise ErroDados(f"empresas.csv, linha {n}: percentual_participacao deve estar entre 0 e 100 (veio {perc}).")
        posicao = texto(l["classificacao"])
        if posicao and not posicao.isdigit():
            raise ErroDados(f"empresas.csv, linha {n}: classificacao deve ser um número inteiro (veio {posicao!r}).")
        if posicao and posicao in posicoes:
            raise ErroDados(f"empresas.csv, linha {n}: classificacao {posicao} repetida.")
        posicoes.add(posicao)
        saida.append([codigo, texto(l["Nome"]), metodo, perc, posicao])
    return saida, codigos, nomes


def preparar_classificacoes():
    cab, dados = ler("hierarquia.csv")
    colunas = ["Classificação Nv1", "Classificação Nv2", "Classificação Nv3", "Ordem Nv1", "Ordem Nv2", "Ordem Nv3"]
    exigir("hierarquia.csv", cab, colunas)
    saida, ids, problemas = [], {}, []
    for n, l in dados:
        niveis = tuple(nivel(l[c]) for c in colunas[:3])
        if not all(niveis):
            problemas.append(f"linha {n}: níveis incompletos {niveis}")
            continue
        if niveis in ids:
            problemas.append(f"linha {n}: {' › '.join(niveis)} repetida")
            continue
        ids[niveis] = len(ids) + 1
        saida.append([ids[niveis], *niveis, *(numero(l[c]) for c in colunas[3:])])
    if problemas:
        raise ErroDados("hierarquia.csv:\n    " + resumir(problemas))
    return saida, ids


def preparar_contas(ids_classificacao, empresas=frozenset()):
    cab, dados = ler("classificacao.csv")
    exigir("classificacao.csv", cab, ["Conta contábil", "Descrição conta", "Classificação Nv1", "Classificação Nv2", "Classificação Nv3"])
    saida, contas, problemas, sem_classificacao = [], set(), [], []
    for n, l in dados:
        conta = texto(l["Conta contábil"])
        if conta in contas:
            problemas.append(f"linha {n}: conta {conta} repetida")
            continue
        contas.add(conta)
        niveis = tuple(nivel(l[c]) for c in ("Classificação Nv1", "Classificação Nv2", "Classificação Nv3"))
        if not any(niveis):
            id_cls = ""                       # em branco: conta sem classificação
            sem_classificacao.append(conta)
        elif niveis in ids_classificacao:
            id_cls = ids_classificacao[niveis]
        else:
            problemas.append(f"linha {n}: conta {conta} em {' › '.join(niveis)}, que não existe na hierarquia")
            continue
        contraparte = texto(l.get("contraparte"))
        if contraparte and contraparte not in empresas:
            problemas.append(f"linha {n}: conta {conta} com contraparte {contraparte}, que não existe em empresas.csv")
            continue
        saida.append([len(saida) + 1, conta, texto(l["Descrição conta"]), id_cls, contraparte])
    if problemas:
        raise ErroDados("classificacao.csv:\n    " + resumir(problemas))
    if sem_classificacao:
        print(f"  (aviso) {len(sem_classificacao)} conta(s) sem classificação, ficam em branco: {', '.join(sem_classificacao)}")
    return saida, contas


def preparar_balancetes(empresas, contas):
    cab, dados = ler("balancetes.csv")
    exigir("balancetes.csv", cab, ["Empresa", "Período", "Conta contábil", "Montante"])
    saida, vistos, problemas = [], set(), []
    for n, l in dados:
        try:
            empresa, conta = texto(l["Empresa"]), texto(l["Conta contábil"])
            periodo, montante = data(l["Período"]), numero(l["Montante"])
        except ValueError as erro:
            problemas.append(f"linha {n}: {erro}")
            continue
        if empresa not in empresas:
            problemas.append(f"linha {n}: empresa {empresa} não existe em empresas.csv")
        elif conta not in contas:
            problemas.append(f"linha {n}: conta {conta} não existe em classificacao.csv")
        elif (empresa, conta, periodo) in vistos:
            problemas.append(f"linha {n}: empresa {empresa}, conta {conta}, {periodo} repetida")
        else:
            vistos.add((empresa, conta, periodo))
            saida.append([empresa, conta, periodo, montante or "0"])
    if problemas:
        raise ErroDados("balancetes.csv:\n    " + resumir(problemas))
    return saida


def carregar_autores(nomes):
    """De-para nome -> id_colab. Devolve o dicionário ou None se faltar algum id."""
    mapa = {}
    if AUTORES.exists():
        with open(AUTORES, encoding="utf-8-sig", newline="") as f:
            for linha in csv.DictReader(f, delimiter=";"):
                mapa[linha["Autor"].strip()] = (linha.get("id_colab") or "").strip()
    faltando = sorted(n for n in nomes if not mapa.get(n))
    if faltando:
        for n in faltando:
            mapa.setdefault(n, "")
        with open(AUTORES, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(["Autor", "id_colab"])
            for nome in sorted(mapa):
                w.writerow([nome, mapa[nome]])
        print(f"  balancetes_comentarios.csv   NÃO gerado: falta o id_colab de {', '.join(faltando)}.")
        print(f"                             Preencha {AUTORES.relative_to(RAIZ)} e rode de novo.")
        return None
    for nome, id_colab in mapa.items():
        if not re.fullmatch(r"\d+", id_colab):
            raise ErroDados(f"{AUTORES.name}: id_colab inválido para {nome!r}: {id_colab!r}")
    return mapa


def preparar_comentarios(empresas, nomes_empresas):
    if not (ORIGEM / "comentarios.csv").exists():
        return None
    cab, dados = ler("comentarios.csv")
    exigir("comentarios.csv", cab, ["Empresa", "Mês atual", "Classificação Nv1", "Comentário", "Autor", "Data/hora"])
    dados = [(n, l) for n, l in dados if texto(l["Comentário"])]
    autores = carregar_autores({texto(l["Autor"]) for _, l in dados if texto(l["Autor"])})
    if autores is None:
        return None
    saida, problemas = [], []
    for n, l in dados:
        empresa = texto(l["Empresa"])
        empresa = empresa if empresa in empresas else nomes_empresas.get(empresa.lower(), "")
        autor = texto(l["Autor"])
        if not empresa:
            problemas.append(f"linha {n}: empresa {texto(l['Empresa'])!r} não existe em empresas.csv")
            continue
        if not autor:
            problemas.append(f"linha {n}: comentário sem autor")
            continue
        try:
            saida.append([
                empresa, data(l["Mês atual"]),
                nivel(l["Classificação Nv1"]), nivel(l.get("Classificação Nv2")), nivel(l.get("Classificação Nv3")),
                texto(l["Comentário"]), autores[autor], data_hora(l["Data/hora"]),
            ])
        except ValueError as erro:
            problemas.append(f"linha {n}: {erro}")
    if problemas:
        raise ErroDados("comentarios.csv:\n    " + resumir(problemas))
    return saida


def mes_inicial():
    """--a-partir AAAA-MM -> 'AAAA-MM-01' (ou None para a carga completa)"""
    if "--a-partir" not in sys.argv:
        return None
    i = sys.argv.index("--a-partir")
    valor = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
    if not re.fullmatch(r"\d{4}-\d{2}", valor):
        print("Use --a-partir AAAA-MM (ex.: --a-partir 2026-11).", file=sys.stderr)
        sys.exit(1)
    return f"{valor}-01"


def main():
    inicio = mes_inicial()
    SAIDA.mkdir(exist_ok=True)
    try:
        empresas, codigos, nomes_empresas = preparar_empresas()
        balancetes_classificacoes, ids_cls = preparar_classificacoes()
        contas, numeros = preparar_contas(ids_cls, codigos)
        balancetes = preparar_balancetes(codigos, numeros)
        comentarios = None if inicio else preparar_comentarios(codigos, nomes_empresas)
    except ErroDados as erro:
        print(f"\nNada foi gerado. Corrija antes de importar:\n  {erro}", file=sys.stderr)
        sys.exit(1)

    if inicio:
        mensal = [l for l in balancetes if l[2] >= inicio]
        gravar(f"balancetes_a_partir_{inicio[:7]}.csv", ["id_empresa", "numero_conta", "periodo_balancete", "montante_balancete"], mensal)
        print("Importe na tabela balancetes_pendencias: as linhas com conta cadastrada vão direto para balancetes\n"
              "(saldos já existentes são atualizados); as de contas novas ficam como pendência em\n"
              "Configurações › Plano de contas e migram sozinhas quando a conta for cadastrada.")
        return

    print(f"\nArquivos em {SAIDA.relative_to(RAIZ)} (importe nesta ordem):")
    gravar("1_empresas.csv", ["id_empresa", "nome_empresa", "metodo_consolidacao", "percentual_participacao", "classificacao_empresa"], empresas)
    gravar("2_balancetes_classificacoes.csv", ["id_classificacao", "nivel1", "nivel2", "nivel3", "ordem_nivel1", "ordem_nivel2", "ordem_nivel3"], balancetes_classificacoes)
    gravar("3_balancetes_contas.csv", ["id_conta", "numero_conta", "desc_conta", "id_classificacao", "id_empresa_contraparte"], contas)
    gravar("4_balancetes.csv", ["id_empresa", "numero_conta", "periodo_balancete", "montante_balancete"], balancetes)
    if comentarios is not None:
        gravar("5_balancetes_comentarios.csv", ["id_empresa", "mes_atual", "nivel1", "nivel2", "nivel3", "mensagem", "id_colab", "criado_em"], comentarios)
    print("Depois da importação, rode supabase/05_apos_importacao.sql.")


if __name__ == "__main__":
    main()
