'use strict';

const success = (res, data = null, message = 'Success', statusCode = 200) =>
  res.status(statusCode).json({ success: true, message, data });

const created = (res, data = null, message = 'Created') =>
  success(res, data, message, 201);

const error = (res, message = 'Internal server error', statusCode = 500, errors = null) =>
  res.status(statusCode).json({ success: false, message, ...(errors && { errors }) });

const paginated = (res, data, { page, limit, total }) =>
  res.status(200).json({
    success: true,
    data,
    pagination: {
      page:       Number(page),
      limit:      Number(limit),
      total,
      totalPages: Math.ceil(total / limit),
      hasMore:    page * limit < total,
    },
  });

module.exports = { success, created, error, paginated };
