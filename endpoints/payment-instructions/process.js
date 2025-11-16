/**
 * Payment Instructions Endpoint
 * Follows template pattern: thin orchestration layer
 */
const { createHandler } = require('@app-core/server');
const parseInstruction = require('@app/services/payment-processor/parse-instruction');
const { appLogger } = require('@app-core/logger');

module.exports = createHandler({
  path: '/payment-instructions',
  method: 'post',
  middlewares: [], // No middleware needed
  props: {
    requiresAuth: false,
  },

  /**
   * Handler orchestrates service call
   */
  async handler(rc, helpers) {
    // Log request
    appLogger.info(
      {
        path: rc.properties.requestURL,
        method: rc.properties.method,
      },
      'payment-instruction-request'
    );

    // Prepare payload
    const payload = {
      accounts: rc.body.accounts || [],
      instruction: rc.body.instruction || '',
    };

    // Call service
    const result = await parseInstruction(payload);

    // Determine HTTP status
    const httpStatus =
      result.status === 'failed'
        ? helpers.http_statuses.HTTP_400_BAD_REQUEST
        : helpers.http_statuses.HTTP_200_OK;

    // Return response
    return {
      status: httpStatus,
      data: result,
    };
  },
});
