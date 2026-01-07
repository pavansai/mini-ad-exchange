
**Mini Ad Exchange - System Design Documentation**
Project Overview
A learning project to understand distributed systems patterns by building light weighted an ad impression tracking system. The project evolved through two phases: direct database writes, then async processing with Kafka.

Phase 1: Direct Database Architecture
System Diagram

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
