# Atomic design layers

Each layer may import only from the layers above it in this list (never sideways to a higher one):

1. `atoms/` — indivisible, stateless UI elements (Button, TextField, StatusBadge). No domain knowledge.
2. `molecules/` — a few atoms with one job (FormField, MoneyInput, TransactionRow).
3. `organisms/` — self-contained feature sections (DepositForm, TransactionList, LoginForm). Receive data and callbacks by props; no fetching.
4. `templates/` — page layouts that place organisms in slots (DashboardTemplate).
5. `src/app/` — Next.js pages: the only place that wires data (`src/lib`) into templates.

Every component folder exposes its public API through an `index.ts` barrel.
