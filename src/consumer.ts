import { Kafka } from "kafkajs";
import pool from './db';

const kafka = new Kafka({
    clientId: 'mini-ad-exchange-consumer',
    brokers: ['localhost:9092'],
});

const consumer = kafka.consumer({ groupId: 'impressions-group' });
async function run() {
    await consumer.connect();
    console.log('Consumer connected');
    await consumer.subscribe({ topic: 'impressions', fromBeginning: true });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            const data = JSON.parse(message.value?.toString() || '{}');
            console.log(`Received: ad_id=${data.ad_id}, partition=${partition}`);
            await pool.query(
                'INSERT INTO impressions (ad_id) VALUES ($1)',
                [data.ad_id]
            );
            console.log(`Inserted impression for ad_id=${data.ad_id}`);
        },
    });
}
run().catch(console.error);
