import { Kafka } from "kafkajs";
import pool from './db';
import { ftruncateSync } from "node:fs";
import { resolve } from "node:dns";

const kafka = new Kafka({
    clientId: 'mini-ad-exchange-consumer',
    brokers: ['localhost:9092'],
});

const consumer = kafka.consumer({ groupId: 'impressions-group' });

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
): Promise<T> {
    if (maxRetries < 1){
        throw new Error('maxRetires should be at least 1');
    }
    let lastError: Error =  new Error('unknown error');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            console.log(`Attemp ${attempt}/${maxRetries} failed: ${lastError.message}`);
            if (attempt < maxRetries) {
                console.log(`Waiting ${delayMs}ms before retry...`);
                await delay(delayMs);
            }
        }
    }
    throw lastError;
}
async function run() {
    await consumer.connect();
    console.log('Consumer connected');
    await consumer.subscribe({ topic: 'impressions', fromBeginning: true });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            const data = JSON.parse(message.value?.toString() || '{}');
            console.log(`Received: ad_id = ${data.ad_id}, partition = ${partition} `);
            await withRetry(async () => {
                await pool.query(
                    `INSERT INTO impressions (ad_id) VALUES ($1)`,
                    [data.ad_id]
                );
            });
            console.log(`Inserted impression for ad_id = ${data.ad_id}`);
        },
    });
}
run().catch(console.error);
