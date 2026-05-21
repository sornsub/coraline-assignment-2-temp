from datetime import datetime

from airflow import DAG
from airflow.operators.bash import BashOperator


with DAG(
    dag_id="sample_external_sync",
    start_date=datetime(2026, 1, 1),
    schedule="@daily",
    catchup=False,
    tags=["demo"],
) as dag:
    BashOperator(
        task_id="show_sync_plan",
        bash_command="echo 'Demo sync would call cloud and on-premise sources through approved private connectivity.'",
    )
