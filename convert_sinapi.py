#!/usr/bin/env python3
"""
Converte a planilha oficial SINAPI "Analítico" (.xlsx) em sinapi_data.json,
o arquivo de dados usado pelo Planejador de Obras (index.html).

USO (todo mês, quando sai a nova base SINAPI):
    python3 convert_sinapi.py "SINAPI_Referencia_2026_07_-_Analitico.xlsx"

Isso sobrescreve sinapi_data.json na mesma pasta. Depois é só publicar os
dois arquivos (index.html + sinapi_data.json) juntos no Vercel (ou onde o
sistema estiver hospedado).

Requer: pip install openpyxl --break-system-packages
"""
import sys
import json
import os

def convert(xlsx_path, out_path=None):
    import openpyxl

    if out_path is None:
        out_path = os.path.join(os.path.dirname(os.path.abspath(xlsx_path)) or ".", "sinapi_data.json")

    print(f"Lendo {xlsx_path} ...")
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)

    # A planilha oficial do SINAPI Analítico normalmente tem uma única aba
    # chamada "Analítico". Se o nome mudar, pega a primeira aba mesmo.
    ws = wb["Analítico"] if "Analítico" in wb.sheetnames else wb[wb.sheetnames[0]]

    items = {}      # codigo -> [descricao, unidade]
    children = {}    # codigo_pai -> [[tipo(0=insumo,1=composicao), codigo_filho, coeficiente], ...]
    tops = []        # [grupo, codigo, descricao, unidade]  (composições selecionáveis)

    n_rows = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        grupo, cod_comp, tipo, cod_item, desc, un, coef, situacao = (list(row) + [None] * 8)[:8]
        if cod_comp is None:
            continue
        n_rows += 1
        if tipo is None:
            # linha de cabeçalho: define uma composição (código do serviço)
            tops.append([grupo, cod_comp, desc, un])
            items.setdefault(cod_comp, [desc, un])
            continue
        # linha filha (INSUMO ou COMPOSICAO)
        items.setdefault(cod_item, [desc, un])
        tflag = 0 if tipo == "INSUMO" else 1
        children.setdefault(cod_comp, []).append([tflag, cod_item, coef])

    data = {"items": items, "children": children, "tops": tops}

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = os.path.getsize(out_path) / 1e6
    print(f"OK: {len(tops)} composições, {len(items)} itens únicos, {n_rows} linhas processadas.")
    print(f"Arquivo gerado: {out_path} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python3 convert_sinapi.py <planilha_sinapi_analitico.xlsx>")
        sys.exit(1)
    convert(sys.argv[1])
