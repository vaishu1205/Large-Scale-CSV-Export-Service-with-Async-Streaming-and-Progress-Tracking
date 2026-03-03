# CSV Export Service

A large-scale CSV export service that streams millions of database rows asynchronously with progress tracking.

## Tech Stack

- Node.js + Express
- PostgreSQL 15
- Redis 7
- Docker + Docker Compose

## Prerequisites

- Docker Desktop for Windows
- Docker Compose

## Setup and Running

1. Clone the repository
2. Copy the environment file:

```
   copy .env.example .env
```

3. Start all services:

```
   docker-compose up --build
```

4. Wait for the database to seed 10 million records (this takes a few minutes on first run)
5. The API will be available at http://localhost:8080

## API Endpoints

### Health Check

```
GET /health
```

### Initiate Export

```
POST /exports/csv
```

Query Parameters:

- `country_code` - Filter by country (e.g. US)
- `subscription_tier` - Filter by tier (e.g. premium)
- `min_ltv` - Minimum lifetime value (e.g. 100.00)
- `columns` - Comma-separated columns (e.g. id,email,country_code)
- `delimiter` - Field delimiter (default: ,)
- `quoteChar` - Quote character (default: ")

### Check Status

```
GET /exports/{exportId}/status
```

### Download CSV

```
GET /exports/{exportId}/download
```

### Cancel Export

```
DELETE /exports/{exportId}
```

## Example Usage

```bash
# Start an export
curl -X POST "http://localhost:8080/exports/csv?country_code=US&min_ltv=500"

# Check status
curl "http://localhost:8080/exports/{exportId}/status"

# Download
curl -O "http://localhost:8080/exports/{exportId}/download"

# Cancel
curl -X DELETE "http://localhost:8080/exports/{exportId}"
```

## Architecture

- Background jobs run asynchronously using Node.js event loop
- PostgreSQL cursors fetch data in chunks of 1000 rows
- Backpressure handled via Node.js stream drain events
- Redis stores job state for fast polling
- Memory limit enforced at 150MB via Docker
