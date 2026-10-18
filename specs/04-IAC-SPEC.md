

### 1. Infrastructure Philosophy & Unified Language

* **Homogeneous Stack:** Adopts AWS CDK in TypeScript so infrastructure code shares the exact same language, types, and developer tooling as both the Next.js frontend and Node.js backend.


* **Pragmatic Execution:** Prioritizes operational simplicity and lean cost management during pre-launch, avoiding over-engineered cluster orchestrators before product-market validation.


* **Reproducibility & Automation:** Defines all cloud topology declaratively to guarantee parity across environments and enable friction-free deployment inside GitHub Actions CI/CD pipelines.



---

### 2. Network Topology & Security Isolation (VPC)

* **Multi-AZ Distribution:** Deploys a Virtual Private Cloud (VPC) spanned across multiple Availability Zones to guarantee fault tolerance and high availability.


* **Public Subnets:** Reserved strictly for the Application Load Balancer (ALB) and network address translation gateways to handle ingress and egress traffic safely.


* **Private Application Subnets:** Host the containerized API layer with outbound internet access for external integrations, while strictly blocking direct inbound traffic from the public internet.


* **Private Isolated Data Subnets:** House the relational database with zero internet routes in or out, enforcing financial industry best practices for secure application design.



---

### 3. Data Layer Resilience (Amazon RDS PostgreSQL)

* **High Availability (Multi-AZ):** Provisions a PostgreSQL database with synchronous replication to a standby instance in an alternate zone for automatic, near-instant failover.


* **Data Protection & Encryption:** Enforces storage encryption at rest alongside managed credential storage via AWS Secrets Manager, eliminating hardcoded database credentials across the codebase.


* **Network-Level Confinement:** Enforces restrictive Security Group rules that allow inbound connections to PostgreSQL only from the authorized application containers.



---

### 4. Serverless Compute & Load Balancing (ECS Fargate + ALB)

* **Serverless Containers:** Runs the Node.js API across Amazon ECS tasks backed by AWS Fargate, removing the operational overhead of patching and maintaining underlying virtual machines.


* **Traffic Distribution:** Directs inbound HTTP traffic across healthy application instances using an Application Load Balancer with periodic health checks.


* **Baseline Redundancy:** Maintains multiple concurrent tasks spread across distinct Availability Zones to avoid single points of failure and accommodate autoscaling under load.



---

### 5. Asynchronous Decoupling & Fault Tolerance (Amazon SQS + DLQ)

* **Event-Driven Messaging:** Employs managed queues to isolate the initial synchronous transaction intake from downstream, high-latency bank clearing workflows.


* **Dead Letter Queue (DLQ):** Retains messages that repeatedly fail processing after a set retry threshold, ensuring transactions are preserved for manual audit rather than lost.



---

### 6. Access Control & Least Privilege (AWS IAM)

* **Constrained Task Roles:** Grants container runtime identities permission only to push messages to their specific SQS queue and read assigned secrets, with no access to unneeded cloud APIs.


* **Scoped Blast Radius:** Eliminates wildcard and administrative permissions, minimizing the fallout of any potential vulnerability in application dependencies.

