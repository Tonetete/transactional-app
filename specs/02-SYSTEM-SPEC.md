### `02-SYSTEM-SPEC.md: System Architecture & Infrastructure Spec`

**1. Architectural Topology Overview**

* **Edge & Routing:** Tráfico entrante gestionado vía AWS WAF conectado a un Application Load Balancer (ALB) público con terminación TLS.


* **Compute Layer:** Contenedores Node.js (TypeScript) desplegados en Amazon ECS con Fargate en subredes privadas, con políticas de auto-escalado horizontal basadas en CPU y consumo de memoria.


* **Data Layer:** Amazon RDS PostgreSQL desplegado en modo Multi-AZ para tolerancia a fallos y alta disponibilidad, confinado en subredes privadas aisladas (`PRIVATE_ISOLATED`) sin acceso a internet.


* **Event-Driven Layer:** Desacoplamiento asíncrono utilizando Amazon SQS junto a funciones serverless AWS Lambda para el procesamiento de transacciones hacia terceros.



**2. Multi-Tenancy Strategy (SaaS Isolation)**

* **Pattern:** Base de datos relacional compartida con aislamiento a nivel de fila (Row-Level Security - RLS) mediante `tenant_id`.


* **Enforcement:**
* Todas las tablas de dominio (`accounts`, `transactions`) incluyen una clave foránea obligatoria `tenant_id`.
* El middleware de la API extrae el tenant verificado desde el JWT de sesión y ejecuta un comando de contexto en la conexión antes de cualquier consulta:
```sql
SET LOCAL app.current_tenant_id = 'tnt_abc';

```


* Las políticas RLS de PostgreSQL deniegan por defecto lecturas o escrituras si el contexto de sesión no coincide con el registro.





**3. Event-Driven Asynchronous Processing**

* **Reliability:** SQS configurado con entrega garantizada y visibilidad adaptada al tiempo de respuesta del servicio bancario externo.


* **Dead Letter Queue (DLQ):** Tras 3 reintentos fallidos en el procesador Lambda, el mensaje se redirige a `TransactionsDLQ` para análisis manual y evitar el bloqueo del pipeline.


* **Deduplication & Idempotency:**
* Verificación en base de datos antes de encolar (`UNIQUE(tenant_id, idempotency_key)`).
* Uso de colas SQS FIFO o verificación secundaria en el consumidor Lambda para garantizar que una reentrega del mensaje nunca duplique el saldo contable.





**4. High Availability & Fault Tolerance**

* **Failover de Base de Datos:** Failover automático síncrono en Amazon RDS Multi-AZ en menos de 60 segundos ante caídas en la zona primaria.


* **Resiliencia del API:** Despliegue mínimo de 2 réplicas ECS distribuidas en diferentes zonas de disponibilidad (AZ) detrás del ALB.


* **Graceful Degradation:** Si el proveedor bancario externo está caído, el endpoint HTTP sigue respondiendo 202 (`PENDING`) y la cola retiene los eventos hasta la recuperación del servicio.

**5. Observability & Security Blueprint**

* **Network Security:** Security Groups restringidos (el ALB solo permite tráfico en 443; ECS solo acepta tráfico proveniente del ALB; RDS solo acepta conexiones desde el Security Group de ECS y Lambda).


* **Distributed Tracing & Correlation:**
* Inyección de cabecera `X-Correlation-Id` en el ALB o middleware de Node.js.
* Propagación del identificador en los atributos del mensaje SQS y en cada log estructurado (JSON) en Amazon CloudWatch / Datadog.
