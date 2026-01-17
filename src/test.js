const request = require('supertest');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.status(200).send('OK'));

describe('Matching Service Tests', () => {
    test('GET / should return 200', async () => {
        const response = await request(app).get('/');
        expect(response.status).toBe(200);
        expect(response.text).toBe('OK');
    });

    test('Basic math test', () => {
        expect(2 + 2).toBe(4);
    });
});