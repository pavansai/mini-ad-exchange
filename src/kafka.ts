import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'mini-ad-exchange',
  brokers: ['localhost:9092'],
});

export const producer = kafka.producer();

export async function connectProducer() {
  await producer.connect();
  console.log('Kafka producer connected');
}

export async function sendImpression(adId: string) {
  await producer.send({
    topic: 'impressions',
    messages: [
      {
        key: adId,
        value: JSON.stringify({
          ad_id: adId,
          timestamp: Date.now(),
        }),
      },
    ],
  });
}
