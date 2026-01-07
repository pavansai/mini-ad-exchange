
Mini Ad Exchange - System Design Documentation
Project Overview
A learning project to understand distributed systems patterns by building light weighted an ad impression tracking system. The project evolved through two phases: direct database writes, then async processing with Kafka.

Phase 1: Direct Database Architecture
System Diagram
┌──────────────────────────────────────────────────────────────────┐
│                         PHASE 1: DIRECT DB                       │
└──────────────────────────────────────────────────────────────────┘

    ┌─────────┐         ┌─────────────────┐         ┌────────────┐
    │  User   │         │   Express API   │         │ PostgreSQL │
    │ Request │────────▶│   (index.ts)    │────────▶│     DB     │
    └─────────┘         └─────────────────┘         └────────────┘
         │                      │                         │
         │                      │    INSERT INTO          │
         │                      │    impressions          │
         │                      │────────────────────────▶│
         │                      │                         │
         │                      │◀────────────────────────│
         │                      │    Wait for response    │
         │◀─────────────────────│                         │
         │   Return 1x1 pixel   │                         │
         │   (blocked until     │                         │
         │    DB responds)      │                         │


    Timeline:
    ─────────────────────────────────────────────────────────────▶
    │ Request │ DB Write │ DB Response │ HTTP Response │
    │  arrives │  starts  │   received  │    sent       │
┌─────────────────────────────────────────────────────────────────┐
│                    BOTTLENECK POINTS                            │
└─────────────────────────────────────────────────────────────────┘

                    ┌─────────────────┐
                    │   100 requests  │
                    │   arrive at     │
                    │   same time     │
                    └────────┬────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │      Connection Pool         │
              │   ┌───┬───┬───┬───┬───┐     │
              │   │ 1 │ 2 │ 3 │...│20 │     │  ← Only 20 connections!
              │   └───┴───┴───┴───┴───┘     │
              │      (default: 20)          │
              └──────────────┬──────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   80 requests   │  ← Must wait in queue
                    │   BLOCKED       │
                    └─────────────────┘

Phase 2: Kafka Architecture
System Diagram
┌──────────────────────────────────────────────────────────────────┐
│                      PHASE 2: KAFKA PATH                         │
└──────────────────────────────────────────────────────────────────┘

    ┌─────────┐      ┌─────────────┐      ┌─────────────────────┐
    │  User   │      │ Express API │      │    Kafka Broker     │
    │ Request │─────▶│ (index.ts)  │─────▶│  (message queue)    │
    └─────────┘      └─────────────┘      └─────────────────────┘
         │                  │                       │
         │                  │  sendImpression()    │
         │                  │  (async, ~2ms)       │
         │                  │──────────────────────▶│
         │                  │                       │
         │◀─────────────────│                       │
         │  Return 1x1      │                       │
         │  pixel IMMEDIATELY                       │
         │                                          │
         │                                          │
         │           ┌──────────────────────────────┘
         │           │ (Meanwhile, in background...)
         │           │
         │           ▼
         │    ┌─────────────┐      ┌────────────┐
         │    │  Consumer   │─────▶│ PostgreSQL │
         │    │(consumer.ts)│      │     DB     │
         │    └─────────────┘      └────────────┘
         │           │                    │
         │           │ INSERT INTO        │
         │           │ impressions        │
         │           │───────────────────▶│
         │           │                    │
         │           │   (at its own      │
         │           │    pace)           │Request Flow (Phase 2)

BACKGROUND PATH (Async):
════════════════════════

         Kafka Queue
         ┌─────────────────────────────────┐
         │ msg1 │ msg2 │ msg3 │ ... │ msgN │
         └──┬──────────────────────────────┘
            │
            ▼
      Consumer polls
            │
            ▼
      INSERT INTO PostgreSQL
            │
            ▼
      Commit offset
            │
            ▼
      Poll next message...
      
   (Happens independently of user requests)How Kafka Protects the Database
┌─────────────────────────────────────────────────────────────────┐
│                    DIRECT COMPARISON                            │
└─────────────────────────────────────────────────────────────────┘

PHASE 1 (Direct DB)              PHASE 2 (Kafka)
═══════════════════              ═══════════════

User ──▶ API ──▶ DB ──▶ User     User ──▶ API ──▶ Kafka ──▶ User
              │                                      │
              │                              Consumer ──▶ DB
              │                              (background)
              ▼                                      
        Synchronous                          Asynchronous
        (blocked)                            (non-blocking)


Response Time:                   Response Time:
├─ API processing                ├─ API processing  
├─ DB write         ◀── SLOW     ├─ Kafka write     ◀── FAST (~2ms)
├─ DB confirmation               └─ Done!
└─ Send response    


Under Load:                      Under Load:
┌────────────────┐               ┌────────────────┐
│ Requests: 25K  │               │ Requests: 100K │
│ Failed: 71.5%  │               │ Failed: 0.1%   │
│ DB crushed     │               │ DB protected   │
└────────────────┘               └────────────────┘

Key Learnings
1. Synchronous vs Asynchronous
SYNCHRONOUS (Phase 1):
─────────────────────
Request must WAIT for database.
If DB is slow, user is slow.
If DB is down, user gets error.

Architecture Summary
┌─────────────────────────────────────────────────────────────────┐
│              MINI AD EXCHANGE - FINAL ARCHITECTURE              │
└─────────────────────────────────────────────────────────────────┘


                         ┌─────────────────┐
                         │   Load Tester   │
                         │   (hey tool)    │
                         └────────┬────────┘
                                  │
                                  │ HTTP GET /impression?ad_id=X
                                  ▼
                         ┌─────────────────┐
                         │  Express.js     │
                         │  API Server     │
                         │  (index.ts)     │
                         │                 │
                         │  - /ad          │
                         │  - /impression  │──────┐
                         │  - /click       │      │
                         └─────────────────┘      │
                                                  │
                         ┌─────────────────┐      │
                         │ Kafka Producer  │◀─────┘
                         │  (kafka.ts)     │
                         └────────┬────────┘
                                  │
                                  │ Send to topic: "impressions"
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        KAFKA BROKER                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Topic: "impressions"                                     │  │
│  │  Partition 0: [msg1][msg2][msg3][msg4][msg5]...          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  │ Consumer polls
                                  ▼
                         ┌─────────────────┐
                         │    Consumer     │
                         │ (consumer.ts)   │
                         │                 │
                         │ Group: "impression-writers"
                         └────────┬────────┘
                                  │
                                  │ INSERT INTO impressions
                                  ▼
                         ┌─────────────────┐
                         │   PostgreSQL    │
                         │                 │
                         │ Tables:         │
                         │ - advertisers   │
                         │ - campaigns     │
                         │ - ads           │
                         │ - impressions   │
                         │ - clicks        │
                         └─────────────────┘
Files Structure
mini-ad-exchange/
├── src/
│   ├── index.ts        # Express API server
│   ├── db.ts           # PostgreSQL connection pool
│   ├── kafka.ts        # Kafka producer
│   └── consumer.ts     # Kafka consumer (separate process)
├── docker-compose.yml  # Kafka broker setup
├── package.json
└── tsconfig.json
Commands Reference
# Start Kafka
docker-compose up -d

# Start API server
npx ts-node src/index.ts

# Start consumer (separate terminal)
npx ts-node src/consumer.ts

# Load test
hey -n 10000 -c 100 "http://localhost:3000/impression?ad_id=1"

# Check impressions count
psql -d mini_ad_exchange -c "SELECT ad_id, COUNT(*) FROM impressions WHERE created_at >= CURRENT_DATE GROUP BY ad_id ORDER BY COUNT(*) DESC;"

# Watch consumer lag (run during load test)
while true; do psql -d mini_ad_exchange -c "SELECT COUNT(*) FROM impressions WHERE ad_id = X;"; sleep 1; done
Documentation created: January 2026 Project: Mini Ad Exchange - System Design Learning