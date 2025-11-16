/**
 * Payment instruction messages following template conventions
 */
module.exports = {
  // Amount validation
  INVALID_AMOUNT: 'Amount must be a positive integer',

  // Currency validation
  CURRENCY_MISMATCH: 'Account currency mismatch',
  UNSUPPORTED_CURRENCY: 'Unsupported currency. Only NGN, USD, GBP, and GHS are supported',

  // Account validation
  INSUFFICIENT_FUNDS: 'Insufficient funds in debit account',
  SAME_ACCOUNT_ERROR: 'Debit and credit accounts cannot be the same',
  ACCOUNT_NOT_FOUND: 'Account not found',
  INVALID_ACCOUNT_ID: 'Invalid account ID format',

  // Date validation
  INVALID_DATE_FORMAT: 'Invalid date format. Must be YYYY-MM-DD',

  // Syntax validation
  MISSING_KEYWORD: 'Missing required keyword',
  INVALID_KEYWORD_ORDER: 'Invalid keyword order',
  MALFORMED_INSTRUCTION: 'Malformed instruction: unable to parse keywords',

  // Success messages
  TRANSACTION_SUCCESSFUL: 'Transaction executed successfully',
  TRANSACTION_PENDING: 'Transaction scheduled for future execution',
};
