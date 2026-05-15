'use strict';
const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const logDir = process.env.LOG_DIR || 'logs';

const fmt = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.splat(),
  format.json(),
);

const consoleFmt = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${message}${extra}`;
  }),
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fmt,
  transports: [
    new transports.Console({ format: consoleFmt }),
    new DailyRotateFile({
      dirname:       path.join(logDir, 'error'),
      filename:      'error-%DATE%.log',
      datePattern:   'YYYY-MM-DD',
      level:         'error',
      maxSize:       '20m',
      maxFiles:      '14d',
      zippedArchive: true,
    }),
    new DailyRotateFile({
      dirname:       path.join(logDir, 'combined'),
      filename:      'combined-%DATE%.log',
      datePattern:   'YYYY-MM-DD',
      maxSize:       '20m',
      maxFiles:      '7d',
      zippedArchive: true,
    }),
  ],
});

module.exports = logger;
