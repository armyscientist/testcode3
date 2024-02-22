import psycopg2
db_params = {
    "host": "localhost",
    "port": 5432,
    "database": "my_database",
    "user": "my_user",
    "password": "my_password"
}
conn = psycopg2.connect(**db_params)
cur = conn.cursor()
cur.execute("SELECT * FROM my_table")
results = cur.fetchall()
cur.close()
conn.close()
for row in results:
    print(row)
