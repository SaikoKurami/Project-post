import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const ANI_API_URL = process.env.ACCESS_API;
const SAIKO_ID = parseInt(process.env.SAIKO_ID);
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const CONTENT_TEMPLATE = process.env.CONTENT_TEMPLATE;
const SCAN_INTERVAL = parseInt(process.env.SCAN_INTERVAL || 600); // Interval in seconds

if (!SAIKO_ID || !ACCESS_TOKEN || !CONTENT_TEMPLATE) {
    console.error('Environment variables SAIKO_ID, ACCESS_TOKEN, or CONTENT_TEMPLATE are missing.');
    process.exit(1);
}

// Serve static files (like index.html)
app.use(express.static(path.join(__dirname, 'public')));

// Route to serve the index.html file
app.get('/', (req, res) => {
    const imagePath = path.join(__dirname, 'index.html');
    res.sendFile(imagePath);
});

app.listen(port, () => {
    console.log('\x1b[36m[ SERVER ]\x1b[0m', '\x1b[32m SH : http://localhost:' + port + ' ✅\x1b[0m');
});

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const fetchGraphQL = async (query, variables) => {
    try {
        await delay(10000); // 10 seconds delay before making the request
        const response = await fetch(ANI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
            },
            body: JSON.stringify({ query, variables }),
        });
        const result = await response.json();

        if (result.errors) {
            console.error('GraphQL Error:', result.errors);
            return null;
        }
        return result.data;
    } catch (error) {
        console.error('Network Error:', error.message);
        return null;
    }
};

const POST_ACTIVITY_MUTATION = `
    mutation ($content: String!) {
        SaveTextActivity(text: $content) {
            id
            text
        }
    }
`;

const getLatestActivities = async () => {
    const GET_LATEST_ACTIVITY_QUERY = `
        query GetLatestActivity($saikoId: Int) {
            Page(page: 1, perPage: 17) {
                activities(userId: $saikoId, sort: [ID_DESC]) {
                    ... on ListActivity {
                        siteUrl
                        createdAt
                        likeCount
                    }
                }
            }
        }
    `;
    const data = await fetchGraphQL(GET_LATEST_ACTIVITY_QUERY, { saikoId: SAIKO_ID });
    return data?.Page?.activities || [];
};

const generateContent = (template, variables) => {
    let content = template;
    for (const [key, value] of Object.entries(variables)) {
        content = content.replaceAll(`{${key}}`, value);
    }
    return content;
};

const analyzeAndPost = async () => {
    try {
        const activities = await getLatestActivities();
        console.log(`Fetched activities on page 1:`, activities);

        const textPostIndex = activities.findIndex((activity) => Object.keys(activity).length === 0);
        if (textPostIndex !== -1) {
            const textPosition = textPostIndex + 1;

            console.log(`Found text activity at position ${textPosition} on page 1`);

            if (textPosition >= 11) {
                const topActivities = activities.slice(0, textPosition - 1);
                const maxLikes = Math.max(...topActivities.map((a) => (a.likeCount || 0)));
                const mostLikedActivities = topActivities.filter((a) => (a.likeCount || 0) === maxLikes);
                const selectedActivity = mostLikedActivities[Math.floor(Math.random() * mostLikedActivities.length)];

                const content = generateContent(CONTENT_TEMPLATE, {
                    SAIKO_ID,
                    CREATED_AT: selectedActivity.createdAt,
                });

                const result = await fetchGraphQL(POST_ACTIVITY_MUTATION, { content });
                if (result) {
                    console.log('TextActivity posted successfully.');
                } else {
                    console.error('Failed to post TextActivity.');
                }
            } else {
                console.log(`Text post at position ${textPosition} does not meet the criteria, scanning again...`);
            }

            const interval = (505 / 3) - (15 * (textPosition - 1));
            console.log(`Waiting for ${interval} minutes before scanning again...`);

            await new Promise((resolve) => setTimeout(resolve, interval * 60000));

            await analyzeAndPost(); // Recursively continue the scan
        } else {
            console.log('No text activity found on page 1.');
        }
    } catch (error) {
        console.error('Error in analyzeAndPost:', error.message);
    }
};

// Start the script
analyzeAndPost().catch((error) => {
    console.error('Error in heartbeat loop:', error.message);
});
