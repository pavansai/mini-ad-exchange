import { Kafka } from "kafkajs";
import pool from './db';

const kafka = new Kafka({
    clientId: 'mini-ad-exchange-consumer',
    brokers: ['localhost:9092'],
});

const consumer = kafka.consumer({ groupId: 'impressions-group' });

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    await consumer.connect();
    console.log('Consumer connected');
    await consumer.subscribe({ topic: 'impressions', fromBeginning: true });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            let data: { ad_id?: string; impression_id?: string; timestamp?: number }
            try {
                const raw = message.value?.toString();
                if (!raw) {
                    console.error("Empty message value, skipping");
                    return
                }
                data = JSON.parse(raw);
                if (!data || typeof data !== 'object' || Array.isArray(data)) {
                    console.error("Parsed value is not object, skipping:", { data, partition });
                    return;
                }
            } catch (err) {
                console.error("Invalid JSON, Skipping message: ", {
                    error: (err as Error).message,
                    value: message.value?.toString(),
                    partition,
                });
                return;
            }
            if (typeof data.ad_id !== 'string' || !data.ad_id) {
                console.error("Missing pr invalid ad_id, skipping;", { data, partition });
                return;
            }
            if (typeof data.impression_id !== 'string' || !data.impression_id) {
                console.error("Missing or invalid impression_id, skipping:", { data, partition });
                return;
            }
            console.log(`Received: ad_id = ${data.ad_id}, impression_id = ${data.impression_id}, partition = ${partition} `);
            try {
                await withRetry(async () => {
                    await pool.query(
                        `INSERT INTO impressions (ad_id, impression_id) VALUES ($1, $2) ON CONFLICT (impression_id) DO NOTHING`,
                        [data.ad_id, data.impression_id]
                    );
                });
                console.log(`Inserted impression for ad_id = ${data.ad_id}`);
            }catch(err){
                console.error(`DB insert impression for ad_id = ${data.ad_id}`, {
                    ad_id: data.ad_id,
                    impression_id: data.impression_id,
                    error: (err as Error).message,
                });
                return;
            }
        },
    });
}

async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
): Promise<T> {
    if (maxRetries < 1) {
        throw new Error('maxRetries should be at least 1');
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            console.log(`Attempt ${attempt}/${maxRetries} failed: ${(error as Error).message}`);
            if (attempt === maxRetries) throw error;
            console.log(`Waiting ${delayMs}ms before retry...`);
            await delay(delayMs);
        }
    }
    throw new Error('Unreachable');
}
run().catch(console.error);
