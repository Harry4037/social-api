'use strict';
// The Express app without a listening port (server.js only listens when run directly)
const request = require('supertest');
const { app } = require('../../src/server');

const API = '/api/v1';
const api = () => request(app);

module.exports = { api, API, app };
