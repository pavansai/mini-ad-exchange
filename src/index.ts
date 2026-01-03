import express from 'express';
import { start } from 'node:repl';
import pool from './db';
import { error } from 'node:console';
import { connectProducer, sendImpression } from './kafka';
const app = express();
const PORT = 3000;


app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/ad', async (req, res) => {
    const slotSize = req.query.slot_size;
    if (!slotSize) {
        res.status(400).json({ error: 'slot_size is required' });
        return;
    }
    const result = await pool.query(`
    SELECT ads.id, ads.image_url, ads.click_url 
    FROM ads
    JOIN campaigns ON ads.campaign_id = campaigns.id
    WHERE ads.size = $1
    AND ads.status = 'active'
    AND campaigns.status = 'active'
    AND campaigns.spent_today < campaigns.daily_budget
    ORDER BY RANDOM()
    LIMIT 1
    `, [slotSize]);

    if (result.rows.length === 0) {
        res.status(404).json({ error: "No ads available at the moment" });
        return;
    }
    const ad = result.rows[0];
    res.json({
        ad_id: ad.id,
        image_url: ad.image_url,
        click_url: `http://localhost:${PORT}/click?ad_id=${ad.id}`,
        impression_url: `http://localhost:${PORT}/impression?ad_id=${ad.id}`,
    })
});
app.get('/impression', async (req, res) => {
    const adId = req.query.ad_id;
    if (!adId) {
        res.status(400).json({ error: 'ad_id is required' });
        return;
    }
    await sendImpression(adId as string);
    
    const pixel = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
    );
    res.setHeader('Content-Type', 'image/gif');
    res.send(pixel);
});


app.get('/click', async (req, res) => {
    const adId = req.query.ad_id;
    if (!adId) {
        res.status(400).json({ error: 'a_id is required' });
        return;
    }

    await pool.query(
        'INSERT INTO clicks (ad_id) VALUES ($1)',
        [adId]
    );

    const result = await pool.query(
        'SELECT click_url FROM ads WHERE id = $1',
        [adId]
    );

    if (result.rows.length === 0) {
        res.status(400).json({ error: 'Ad not found' });
        return;
    }
})
connectProducer().then(() => {
    app.listen(PORT, () => {
        console.log(`Ad server running on http://localhost:${PORT}`);
    });
});

