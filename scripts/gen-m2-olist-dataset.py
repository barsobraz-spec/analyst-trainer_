#!/usr/bin/env python3
"""Генератор сквозного датасета месяца 2 (SQL).

Подвыборка-стилизация Olist: схема и распределения похожи на реальный набор,
бразильские штаты и категории. Намеренно добавлен «беспорядок» (NULL, дубли,
опечатки и регистр городов) — это часть учебной задачи.

Запуск:
    python3 scripts/gen-m2-olist-dataset.py
"""

import json
import os
import random
from datetime import datetime, timedelta, timezone

SEED = 20260101
rnd = random.Random(SEED)


def pick(arr):
    return arr[rnd.randrange(len(arr))]


def pick_weighted(items):
    values, weights = zip(*items)
    return rnd.choices(values, weights=weights, k=1)[0]


def pad(n, w):
    return str(n).zfill(w)


CITIES_BY_STATE = {
    "SP": ["sao paulo", "campinas", "santo andre", "sao jose dos campos", "sorocaba"],
    "RJ": ["rio de janeiro", "niteroi", "duque de caxias"],
    "MG": ["belo horizonte", "uberlandia", "contagem"],
    "RS": ["porto alegre", "caxias do sul"],
    "PR": ["curitiba", "londrina"],
    "BA": ["salvador"],
    "PE": ["recife"],
    "DF": ["brasilia"],
    "CE": ["fortaleza"],
}
STATE_WEIGHTS = [("SP", 42), ("RJ", 13), ("MG", 12), ("RS", 6), ("PR", 6),
                 ("BA", 4), ("PE", 4), ("DF", 3), ("CE", 3)]

CATEGORY_WEIGHTS = [
    ("cama_mesa_banho", 12), ("beleza_saude", 11), ("esporte_lazer", 9),
    ("moveis_decoracao", 9), ("informatica_acessorios", 10), ("utilidades_domesticas", 8),
    ("relogios_presentes", 6), ("telefonia", 6), ("ferramentas_jardim", 5),
    ("brinquedos", 5), ("cool_stuff", 4), ("perfumaria", 4), ("automotivo", 4),
    ("bebes", 3), ("livros_interesse_geral", 2), ("pet_shop", 2),
]

PAYMENT_WEIGHTS = [("credit_card", 73), ("boleto", 19), ("voucher", 5), ("debit_card", 3)]
STATUS_WEIGHTS = [("delivered", 88), ("shipped", 5), ("canceled", 3),
                  ("unavailable", 2), ("invoiced", 1), ("processing", 1)]
INSTALLMENTS_WEIGHTS = [(1, 50), (2, 15), (3, 12), (4, 8), (5, 5), (6, 4), (10, 4), (12, 2)]
ITEM_COUNT_WEIGHTS = [(1, 70), (2, 20), (3, 8), (4, 2)]
REVIEW_SCORE_WEIGHTS = [(5, 57), (4, 19), (3, 8), (2, 4), (1, 12)]


def sample_price():
    x = rnd.random()
    if x < 0.55:
        return round(30 + rnd.random() * 170, 2)
    if x < 0.85:
        return round(200 + rnd.random() * 400, 2)
    if x < 0.97:
        return round(600 + rnd.random() * 1400, 2)
    return round(2000 + rnd.random() * 4500, 2)


def sample_freight(price):
    import math
    base = 6 + math.log10(max(price, 30)) * 4
    return round(base + (rnd.random() - 0.5) * 6, 2)


def dirty_city(canonical):
    r = rnd.random()
    if r < 0.85:
        return canonical
    if r < 0.92:
        return canonical.upper()
    if r < 0.96:
        # Title Case
        return " ".join(w.capitalize() for w in canonical.split())
    if len(canonical) > 4:
        return canonical[:2] + canonical[3:]
    return canonical


N_CUSTOMERS = 220
N_SELLERS = 35
N_PRODUCTS = 90
N_ORDERS = 260

# Customers
customers = []
for i in range(1, N_CUSTOMERS + 1):
    state = pick_weighted(STATE_WEIGHTS)
    city_canon = pick(CITIES_BY_STATE[state])
    customers.append([
        f"c{pad(i, 4)}",
        f"u{pad(rnd.randint(1, N_CUSTOMERS - 5), 4)}",
        rnd.randint(1000, 99000),
        dirty_city(city_canon),
        state,
    ])

# Sellers
sellers = []
for i in range(1, N_SELLERS + 1):
    state = pick_weighted(STATE_WEIGHTS)
    city_canon = pick(CITIES_BY_STATE[state])
    sellers.append([
        f"s{pad(i, 3)}",
        rnd.randint(1000, 99000),
        city_canon,
        state,
    ])

# Products
products = []
for i in range(1, N_PRODUCTS + 1):
    category = pick_weighted(CATEGORY_WEIGHTS)
    cat_val = None if rnd.random() < 0.08 else category
    products.append([
        f"p{pad(i, 4)}",
        cat_val,
        rnd.randint(100, 8000),
        rnd.randint(10, 80),
        rnd.randint(5, 60),
        rnd.randint(5, 50),
    ])


def ts(d):
    return d.strftime("%Y-%m-%d %H:%M:%S")


def add_days(d, days):
    return d + timedelta(days=days)


def sample_order_date():
    start = datetime(2017, 2, 1, tzinfo=timezone.utc)
    end = datetime(2018, 8, 31, tzinfo=timezone.utc)
    span = (end - start).total_seconds()
    d = start + timedelta(seconds=rnd.random() * span)
    # Q4 boost: с шансом 0.35 сдвигаем дату в окт-янв 2017-2018.
    if rnd.random() < 0.35 and d.month < 10 and d.month != 1:
        s_start = datetime(2017, 10, 1, tzinfo=timezone.utc)
        s_end = datetime(2018, 1, 31, tzinfo=timezone.utc)
        s_span = (s_end - s_start).total_seconds()
        d = s_start + timedelta(seconds=rnd.random() * s_span)
    return d


orders = []
order_items = []
order_payments = []
order_reviews = []

for i in range(1, N_ORDERS + 1):
    order_id = f"o{pad(i, 5)}"
    customer = customers[rnd.randrange(len(customers))]
    customer_id = customer[0]
    status = pick_weighted(STATUS_WEIGHTS)

    purchase = sample_order_date()
    approved = None if (status == "canceled" and rnd.random() < 0.4) else add_days(purchase, rnd.random() * 0.5)
    carrier = add_days(purchase, 1 + rnd.random() * 4) if status in ("delivered", "shipped") else None
    delivered = add_days(purchase, 5 + rnd.random() * 18) if status == "delivered" else None
    estimated = add_days(purchase, 10 + rnd.random() * 20)

    orders.append([
        order_id,
        customer_id,
        status,
        ts(purchase),
        ts(approved) if approved else None,
        ts(carrier) if carrier else None,
        ts(delivered) if delivered else None,
        ts(estimated),
    ])

    item_count = pick_weighted(ITEM_COUNT_WEIGHTS)
    total = 0.0
    for k in range(1, item_count + 1):
        product = products[rnd.randrange(len(products))]
        seller = sellers[rnd.randrange(len(sellers))]
        price = sample_price()
        freight = sample_freight(price)
        total += price + freight
        order_items.append([
            order_id, k, product[0], seller[0],
            ts(add_days(purchase, 2 + rnd.random() * 5)),
            price, freight,
        ])

    pay_types = [pick_weighted(PAYMENT_WEIGHTS)] if rnd.random() < 0.9 else ["voucher", pick_weighted(PAYMENT_WEIGHTS)]
    seq = 0
    remaining = total
    for pt in pay_types:
        seq += 1
        if len(pay_types) > 1 and seq < len(pay_types):
            value = round(remaining * 0.3, 2)
        else:
            value = round(remaining, 2)
        remaining -= value
        installments = pick_weighted(INSTALLMENTS_WEIGHTS) if pt == "credit_card" else 1
        order_payments.append([order_id, seq, pt, installments, value])

    has_review = (status == "delivered" and rnd.random() < 0.85) or (status != "delivered" and rnd.random() < 0.2)
    if has_review:
        score = pick_weighted(REVIEW_SCORE_WEIGHTS)
        review_date = add_days(delivered if delivered else purchase, 1 + rnd.random() * 6)
        order_reviews.append([
            f"r{pad(len(order_reviews) + 1, 5)}",
            order_id,
            score,
            ts(review_date)[:10],
        ])

# Беспорядок
orders.append(list(orders[42]))  # дубль строки
order_items.append([orders[10][0], 99, "p9999", "s999", orders[10][3], 199.0, 12.5])  # сироты
order_items.append([orders[5][0], 5, products[0][0], sellers[0][0], orders[5][3], 12999.99, 89.5])  # выброс

# Часть delivered без даты доставки
for row in orders:
    if row[2] == "delivered" and row[6] is not None and rnd.random() < 0.04:
        row[6] = None

dataset = {
    "tables": [
        {
            "name": "customers",
            "columns": [
                {"name": "customer_id", "type": "TEXT"},
                {"name": "customer_unique_id", "type": "TEXT"},
                {"name": "customer_zip_code_prefix", "type": "INTEGER"},
                {"name": "customer_city", "type": "TEXT"},
                {"name": "customer_state", "type": "TEXT"},
            ],
            "rows": customers,
        },
        {
            "name": "sellers",
            "columns": [
                {"name": "seller_id", "type": "TEXT"},
                {"name": "seller_zip_code_prefix", "type": "INTEGER"},
                {"name": "seller_city", "type": "TEXT"},
                {"name": "seller_state", "type": "TEXT"},
            ],
            "rows": sellers,
        },
        {
            "name": "products",
            "columns": [
                {"name": "product_id", "type": "TEXT"},
                {"name": "product_category_name", "type": "TEXT"},
                {"name": "product_weight_g", "type": "INTEGER"},
                {"name": "product_length_cm", "type": "INTEGER"},
                {"name": "product_height_cm", "type": "INTEGER"},
                {"name": "product_width_cm", "type": "INTEGER"},
            ],
            "rows": products,
        },
        {
            "name": "orders",
            "columns": [
                {"name": "order_id", "type": "TEXT"},
                {"name": "customer_id", "type": "TEXT"},
                {"name": "order_status", "type": "TEXT"},
                {"name": "order_purchase_timestamp", "type": "TEXT"},
                {"name": "order_approved_at", "type": "TEXT"},
                {"name": "order_delivered_carrier_date", "type": "TEXT"},
                {"name": "order_delivered_customer_date", "type": "TEXT"},
                {"name": "order_estimated_delivery_date", "type": "TEXT"},
            ],
            "rows": orders,
        },
        {
            "name": "order_items",
            "columns": [
                {"name": "order_id", "type": "TEXT"},
                {"name": "order_item_id", "type": "INTEGER"},
                {"name": "product_id", "type": "TEXT"},
                {"name": "seller_id", "type": "TEXT"},
                {"name": "shipping_limit_date", "type": "TEXT"},
                {"name": "price", "type": "REAL"},
                {"name": "freight_value", "type": "REAL"},
            ],
            "rows": order_items,
        },
        {
            "name": "order_payments",
            "columns": [
                {"name": "order_id", "type": "TEXT"},
                {"name": "payment_sequential", "type": "INTEGER"},
                {"name": "payment_type", "type": "TEXT"},
                {"name": "payment_installments", "type": "INTEGER"},
                {"name": "payment_value", "type": "REAL"},
            ],
            "rows": order_payments,
        },
        {
            "name": "order_reviews",
            "columns": [
                {"name": "review_id", "type": "TEXT"},
                {"name": "order_id", "type": "TEXT"},
                {"name": "review_score", "type": "INTEGER"},
                {"name": "review_creation_date", "type": "TEXT"},
            ],
            "rows": order_reviews,
        },
    ]
}

here = os.path.dirname(os.path.abspath(__file__))
out_path = os.path.join(here, "..", "cases", "datasets", "sql-m2-olist.json")
out_path = os.path.normpath(out_path)
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(dataset, f, ensure_ascii=False)
print("Wrote", out_path)
print("rows:", {
    "customers": len(customers),
    "sellers": len(sellers),
    "products": len(products),
    "orders": len(orders),
    "order_items": len(order_items),
    "order_payments": len(order_payments),
    "order_reviews": len(order_reviews),
})
