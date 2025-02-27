import express from 'express';
import path from 'path';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const ANI_API_URL = process.env.ACCESS_API;
const SAIKO_ID = parseInt(process.env.SAIKO_ID);
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const CONTENT_TEMPLATE = process.env.CONTENT_TEMPLATE;
const COMMENT_TEMPLATE = process.env.COMMENT_TEMPLATE;
const SCAN_INTERVAL = parseInt(process.env.SCAN_INTERVAL || 600); // Interval in seconds

if (!SAIKO_ID || !ACCESS_TOKEN || !CONTENT_TEMPLATE) {
    console.error('Environment variables SAIKO_ID, ACCESS_TOKEN, or CONTENT_TEMPLATE are missing.');
    process.exit(1);
}

// GraphQL queries and mutations
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

const POST_ACTIVITY_MUTATION = `
    mutation ($content: String!) {
        SaveTextActivity(text: $content) {
            id
            text
        }
    }
`;

const POST_COMMENT_MUTATION = `
    mutation ($activityId: Int!, $comment: String!) {
        SaveActivityReply(activityId: $activityId, text: $comment) {
            id
            text
        }
    }
`;

// Helper functions
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const countdown = async (minutes) => {
    console.log(`Waiting for ${minutes} minutes before scanning again...`);
    for (let i = minutes; i > 0; i--) {
        console.log(`Time remaining: ${i} minute${i > 1 ? 's' : ''}`);
        await delay(60000); // 1 minute delay
    }
};

const fetchGraphQL = async (query, variables) => {
    try {
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

const postStatus = async (content) => {
    const data = await fetchGraphQL(POST_ACTIVITY_MUTATION, { content });
    if (data) {
        console.log('Post created successfully:', data.SaveTextActivity);
        return data.SaveTextActivity;
    }
    return null;
};

const postComment = async (activityId, commentContent) => {
    const data = await fetchGraphQL(POST_COMMENT_MUTATION, { activityId, comment: commentContent });
    if (data) {
        console.log('Comment posted successfully:', data.SaveActivityReply);
        return data.SaveActivityReply;
    }
    return null;
};

const getLatestActivities = async () => {
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
        if (!activities.length) {
            console.log('No activities found or too many requests. Retrying...');
            await countdown(10); // Wait for 10 minutes before retrying
            await analyzeAndPost();
            return;
        }

        console.log(`Fetched activities on page 1:`, activities);

        const textPostIndex = activities.findIndex((activity) => Object.keys(activity).length === 0);
        if (textPostIndex !== -1) {
            const textPosition = textPostIndex + 1;
            console.log(`Found text activity at position ${textPosition}`);

            if (textPosition >= 11) {
                const topActivities = activities.slice(0, textPosition - 1);
                const maxLikes = Math.max(...topActivities.map((a) => (a.likeCount || 0)));
                const mostLikedActivities = topActivities.filter((a) => (a.likeCount || 0) === maxLikes);

                const selectedActivity = mostLikedActivities[Math.floor(Math.random() * mostLikedActivities.length)];

                const content = generateContent(CONTENT_TEMPLATE, {
                    SAIKO_ID,
                    CREATED_AT: selectedActivity.createdAt,
                });

                const result = await postStatus(content);
                if (result) {
                    console.log('TextActivity posted successfully.');
                    // Wait for 10 seconds before posting the comment
                    await delay(10000);

                    // Post a follow-up comment
                    const commentContent = COMMENT_TEMPLATE;
                    await postComment(result.id, commentContent);

                } else {
                    console.error('Failed to post TextActivity.');
                }
            } else {
                console.log(`Text post at position ${textPosition} does not meet the criteria, scanning again...`);
            }

            const interval = Math.max(1, Math.floor((230) - (20 * (textPosition - 1)))); // Ensure interval is at least 1 minute
            await countdown(interval);

            await analyzeAndPost();
        } else {
            console.log('No text activity found');
        }
    } catch (error) {
        console.error('Error in analyzeAndPost:', error.message);
        await countdown(10); // Wait for 10 minutes before retrying in case of error
        await analyzeAndPost();
    }
};

// Set up Express server
const app = express();
const port = 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get('/', (req, res) => {
    const imagePath = path.join(__dirname, 'index.html');
    res.sendFile(imagePath);
});

app.listen(port, () => {
    console.log(`\x1b[36m[ SERVER ]\x1b[0m \x1b[32m SH : http://localhost:${port} ✅\x1b[0m`);
});

analyzeAndPost().catch((error) => {
    console.error('Error in heartbeat loop:', error.message);
});
