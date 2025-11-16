/**
 * Payment Instruction Parser Service
 * Implements state machine parsing without regex
 * Follows template conventions: validation first, single exit point
 */
const validator = require('@app-core/validator');
const { appLogger } = require('@app-core/logger');
const { PaymentMessages } = require('@app/messages');

/**
 * VSL spec for input validation
 */
const spec = `root {
  accounts[] {
    id string
    balance number
    currency string
  }
  instruction string
}`;

// Parse spec once at module level for efficiency
const parsedSpec = validator.parse(spec);

// Supported currencies
const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GBP', 'GHS'];

// Status codes mapping
const STATUS_CODES = {
  // Success
  SUCCESSFUL: 'AP00',
  PENDING: 'AP02',

  // Errors by priority
  MALFORMED: 'SY03',
  MISSING_KEYWORD: 'SY01',
  INVALID_ORDER: 'SY02',
  INVALID_AMOUNT: 'AM01',
  INVALID_ACCOUNT_ID: 'AC04',
  INVALID_DATE: 'DT01',
  ACCOUNT_NOT_FOUND: 'AC03',
  UNSUPPORTED_CURRENCY: 'CU02',
  CURRENCY_MISMATCH: 'CU01',
  SAME_ACCOUNT: 'AC02',
  INSUFFICIENT_FUNDS: 'AC01',
};

/**
 * State machine states
 */
const States = {
  START: 'START',
  TYPE: 'TYPE',
  AMOUNT: 'AMOUNT',
  CURRENCY: 'CURRENCY',
  FIRST_KEYWORD: 'FIRST_KEYWORD',
  FIRST_ACCOUNT_KEYWORD: 'FIRST_ACCOUNT_KEYWORD',
  FIRST_ACCOUNT: 'FIRST_ACCOUNT',
  FOR: 'FOR',
  SECOND_TYPE: 'SECOND_TYPE',
  SECOND_KEYWORD: 'SECOND_KEYWORD',
  SECOND_ACCOUNT_KEYWORD: 'SECOND_ACCOUNT_KEYWORD',
  SECOND_ACCOUNT: 'SECOND_ACCOUNT',
  ON: 'ON',
  DATE: 'DATE',
  COMPLETE: 'COMPLETE',
};

/**
 * Tokenize instruction into words
 */
function tokenize(instruction) {
  // Normalize whitespace
  const normalized = instruction.trim().replace(/\s+/g, ' ');
  return normalized.split(' ').filter((word) => word.length > 0);
}

/**
 * Check if account ID has valid characters
 * Allowed: letters, numbers, hyphen, period, at symbol
 */
function isValidAccountId(id) {
  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < id.length; i++) {
    const char = id[i];
    const isLetter = (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
    const isNumber = char >= '0' && char <= '9';
    const isSpecial = char === '-' || char === '.' || char === '@';

    if (!isLetter && !isNumber && !isSpecial) {
      return false;
    }
  }
  return true;
}

/**
 * Validate YYYY-MM-DD format
 */
function isValidDateFormat(date) {
  if (date.length !== 10) return false;
  if (date[4] !== '-' || date[7] !== '-') return false;

  const year = date.substring(0, 4);
  const month = date.substring(5, 7);
  const day = date.substring(8, 10);

  // Check numeric
  const digits = year + month + day;
  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < digits.length; i++) {
    if (digits[i] < '0' || digits[i] > '9') return false;
  }

  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);

  return monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31;
}

/**
 * Check if date is future (UTC)
 */
function isFutureDate(dateStr) {
  const now = new Date();
  const inputDate = new Date(`${dateStr}T00:00:00Z`);

  const nowDate = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const compareDate = new Date(
    inputDate.getUTCFullYear(),
    inputDate.getUTCMonth(),
    inputDate.getUTCDate()
  );

  return compareDate > nowDate;
}

/**
 * State machine parser
 * Returns parsed data with collected errors
 */
function parseWithStateMachine(tokens) {
  let state = States.START;
  let index = 0;

  const result = {
    type: null,
    amount: null,
    currency: null,
    debitAccount: null,
    creditAccount: null,
    executeBy: null,
    errors: [],
  };

  /**
   * Process each token based on current state
   */
  while (index < tokens.length && state !== States.COMPLETE) {
    const token = tokens[index];
    const tokenUpper = token.toUpperCase();

    switch (state) {
      case States.START:
        // Expect DEBIT or CREDIT
        if (tokenUpper === 'DEBIT' || tokenUpper === 'CREDIT') {
          result.type = tokenUpper;
          state = States.TYPE;
        } else {
          result.errors.push({
            code: STATUS_CODES.MISSING_KEYWORD,
            message: PaymentMessages.MISSING_KEYWORD,
          });
          return result;
        }
        break;

      case States.TYPE: {
        // Expect amount
        const amount = parseInt(token, 10);
        if (token.includes('.')) {
          result.errors.push({
            code: STATUS_CODES.INVALID_AMOUNT,
            message: PaymentMessages.INVALID_AMOUNT,
          });
        } else if (Number.isNaN(amount) || amount <= 0) {
          result.errors.push({
            code: STATUS_CODES.INVALID_AMOUNT,
            message: PaymentMessages.INVALID_AMOUNT,
          });
        } else {
          result.amount = amount;
        }
        state = States.AMOUNT;
        break;
      }

      case States.AMOUNT:
        // Expect currency
        result.currency = tokenUpper;
        state = States.CURRENCY;
        break;

      case States.CURRENCY: {
        // Expect FROM (for DEBIT) or TO (for CREDIT)
        const expectedFirst = result.type === 'DEBIT' ? 'FROM' : 'TO';
        if (tokenUpper === expectedFirst) {
          state = States.FIRST_KEYWORD;
        } else {
          result.errors.push({
            code: STATUS_CODES.INVALID_ORDER,
            message: PaymentMessages.INVALID_KEYWORD_ORDER,
          });
          return result;
        }
        break;
      }

      case States.FIRST_KEYWORD:
        // Expect ACCOUNT
        if (tokenUpper === 'ACCOUNT') {
          state = States.FIRST_ACCOUNT_KEYWORD;
        } else {
          result.errors.push({
            code: STATUS_CODES.MISSING_KEYWORD,
            message: PaymentMessages.MISSING_KEYWORD,
          });
          return result;
        }
        break;

      case States.FIRST_ACCOUNT_KEYWORD:
        // Get account ID (case-sensitive)
        if (result.type === 'DEBIT') {
          result.debitAccount = token;
        } else {
          result.creditAccount = token;
        }
        state = States.FIRST_ACCOUNT;
        break;

      case States.FIRST_ACCOUNT:
        // Expect FOR
        if (tokenUpper === 'FOR') {
          state = States.FOR;
        } else {
          result.errors.push({
            code: STATUS_CODES.MISSING_KEYWORD,
            message: PaymentMessages.MISSING_KEYWORD,
          });
          return result;
        }
        break;

      case States.FOR: {
        // Expect CREDIT (for DEBIT) or DEBIT (for CREDIT)
        const expectedSecondType = result.type === 'DEBIT' ? 'CREDIT' : 'DEBIT';
        if (tokenUpper === expectedSecondType) {
          state = States.SECOND_TYPE;
        } else {
          result.errors.push({
            code: STATUS_CODES.INVALID_ORDER,
            message: PaymentMessages.INVALID_KEYWORD_ORDER,
          });
          return result;
        }
        break;
      }

      case States.SECOND_TYPE: {
        // Expect TO (for DEBIT) or FROM (for CREDIT)
        const expectedSecond = result.type === 'DEBIT' ? 'TO' : 'FROM';
        if (tokenUpper === expectedSecond) {
          state = States.SECOND_KEYWORD;
        } else {
          result.errors.push({
            code: STATUS_CODES.INVALID_ORDER,
            message: PaymentMessages.INVALID_KEYWORD_ORDER,
          });
          return result;
        }
        break;
      }

      case States.SECOND_KEYWORD:
        // Expect ACCOUNT
        if (tokenUpper === 'ACCOUNT') {
          state = States.SECOND_ACCOUNT_KEYWORD;
        } else {
          result.errors.push({
            code: STATUS_CODES.MISSING_KEYWORD,
            message: PaymentMessages.MISSING_KEYWORD,
          });
          return result;
        }
        break;

      case States.SECOND_ACCOUNT_KEYWORD:
        // Get second account ID (case-sensitive)
        if (result.type === 'DEBIT') {
          result.creditAccount = token;
        } else {
          result.debitAccount = token;
        }
        state = States.SECOND_ACCOUNT;
        break;

      case States.SECOND_ACCOUNT:
        // Check for optional ON
        if (tokenUpper === 'ON') {
          state = States.ON;
        } else {
          // Unexpected token
          result.errors.push({
            code: STATUS_CODES.MALFORMED,
            message: PaymentMessages.MALFORMED_INSTRUCTION,
          });
          return result;
        }
        break;

      case States.ON:
        // Get date
        if (isValidDateFormat(token)) {
          result.executeBy = token;
        } else {
          result.errors.push({
            code: STATUS_CODES.INVALID_DATE,
            message: PaymentMessages.INVALID_DATE_FORMAT,
          });
        }
        state = States.DATE;
        break;

      case States.DATE:
        // Should be complete, extra tokens
        result.errors.push({
          code: STATUS_CODES.MALFORMED,
          message: PaymentMessages.MALFORMED_INSTRUCTION,
        });
        return result;

      default:
        // Unknown state
        result.errors.push({
          code: STATUS_CODES.MALFORMED,
          message: PaymentMessages.MALFORMED_INSTRUCTION,
        });
        return result;
    }

    index++;
  }

  // Check if we completed successfully
  if (state === States.SECOND_ACCOUNT || state === States.DATE) {
    state = States.COMPLETE;
  }

  if (state !== States.COMPLETE) {
    if (result.errors.length === 0) {
      result.errors.push({
        code: STATUS_CODES.MALFORMED,
        message: PaymentMessages.MALFORMED_INSTRUCTION,
      });
    }
  }

  return result;
}

/**
 * Validate business rules and collect all errors
 */
function validateBusinessRules(parsed, accounts) {
  const errors = [...parsed.errors];

  // Validate account ID formats
  if (parsed.debitAccount && !isValidAccountId(parsed.debitAccount)) {
    errors.push({
      code: STATUS_CODES.INVALID_ACCOUNT_ID,
      message: `${PaymentMessages.INVALID_ACCOUNT_ID}: ${parsed.debitAccount}`,
    });
  }

  if (parsed.creditAccount && !isValidAccountId(parsed.creditAccount)) {
    errors.push({
      code: STATUS_CODES.INVALID_ACCOUNT_ID,
      message: `${PaymentMessages.INVALID_ACCOUNT_ID}: ${parsed.creditAccount}`,
    });
  }

  // Check same account
  if (parsed.debitAccount === parsed.creditAccount) {
    errors.push({
      code: STATUS_CODES.SAME_ACCOUNT,
      message: PaymentMessages.SAME_ACCOUNT_ERROR,
    });
  }

  // Validate currency support
  if (parsed.currency && !SUPPORTED_CURRENCIES.includes(parsed.currency)) {
    errors.push({
      code: STATUS_CODES.UNSUPPORTED_CURRENCY,
      message: PaymentMessages.UNSUPPORTED_CURRENCY,
    });
  }

  // Find accounts
  const debitAccount = accounts.find((a) => a.id === parsed.debitAccount);
  const creditAccount = accounts.find((a) => a.id === parsed.creditAccount);

  if (parsed.debitAccount && !debitAccount) {
    errors.push({
      code: STATUS_CODES.ACCOUNT_NOT_FOUND,
      message: `${PaymentMessages.ACCOUNT_NOT_FOUND}: ${parsed.debitAccount}`,
    });
  }

  if (parsed.creditAccount && !creditAccount) {
    errors.push({
      code: STATUS_CODES.ACCOUNT_NOT_FOUND,
      message: `${PaymentMessages.ACCOUNT_NOT_FOUND}: ${parsed.creditAccount}`,
    });
  }

  // Validate if accounts exist
  if (debitAccount && creditAccount) {
    // Currency mismatch between accounts
    if (debitAccount.currency !== creditAccount.currency) {
      errors.push({
        code: STATUS_CODES.CURRENCY_MISMATCH,
        message: PaymentMessages.CURRENCY_MISMATCH,
      });
    }

    // Currency mismatch with instruction
    if (parsed.currency && debitAccount.currency.toUpperCase() !== parsed.currency) {
      errors.push({
        code: STATUS_CODES.CURRENCY_MISMATCH,
        message: `Currency mismatch: instruction says ${parsed.currency} but account has ${debitAccount.currency.toUpperCase()}`,
      });
    }

    // Insufficient funds
    if (parsed.amount && debitAccount.balance < parsed.amount) {
      errors.push({
        code: STATUS_CODES.INSUFFICIENT_FUNDS,
        message: `${PaymentMessages.INSUFFICIENT_FUNDS}: has ${debitAccount.balance} ${debitAccount.currency}, needs ${parsed.amount}`,
      });
    }
  }

  return {
    errors,
    debitAccount,
    creditAccount,
  };
}

/**
 * Prioritize errors - return most important
 * Priority: Syntax > Format > Not Found > Currency > Business
 */
function selectPrimaryError(errors) {
  const priority = {
    SY03: 1,
    SY01: 2,
    SY02: 3,
    AM01: 4,
    AC04: 5,
    DT01: 6,
    AC03: 7,
    CU02: 8,
    CU01: 9,
    AC02: 10,
    AC01: 11,
  };

  let primaryError = null;
  let lowestPriority = 999;

  errors.forEach((error) => {
    const p = priority[error.code] || 999;
    if (p < lowestPriority) {
      lowestPriority = p;
      primaryError = error;
    }
  });

  return primaryError;
}

/**
 * Main service function
 * Template convention: (serviceData, options = {})
 */
async function parseInstruction(serviceData) {
  // Single variable for return
  let response;

  // Validation first (template requirement)
  const data = validator.validate(serviceData, parsedSpec);

  try {
    // Log the operation
    appLogger.info(
      {
        instruction: data.instruction,
        accounts: data.accounts.length,
      },
      'parse-instruction-start'
    );

    // Tokenize
    const tokens = tokenize(data.instruction);

    // Parse with state machine
    const parsed = parseWithStateMachine(tokens);

    // Validate business rules
    const validation = validateBusinessRules(parsed, data.accounts);

    // Check for errors
    if (validation.errors.length > 0) {
      const error = selectPrimaryError(validation.errors);

      // Build error response
      if (
        error.code === STATUS_CODES.MALFORMED ||
        error.code === STATUS_CODES.MISSING_KEYWORD ||
        error.code === STATUS_CODES.INVALID_ORDER
      ) {
        // Unparseable - return nulls
        response = {
          type: null,
          amount: null,
          currency: null,
          debit_account: null,
          credit_account: null,
          execute_by: null,
          status: 'failed',
          status_reason: error.message,
          status_code: error.code,
          accounts: [],
        };
      } else {
        // Parseable but invalid - return parsed values
        const involvedAccounts = [];
        data.accounts.forEach((account) => {
          if (account.id === parsed.debitAccount || account.id === parsed.creditAccount) {
            involvedAccounts.push({
              id: account.id,
              balance: account.balance,
              balance_before: account.balance,
              currency: account.currency.toUpperCase(),
            });
          }
        });

        response = {
          type: parsed.type,
          amount: parsed.amount,
          currency: parsed.currency,
          debit_account: parsed.debitAccount,
          credit_account: parsed.creditAccount,
          execute_by: parsed.executeBy,
          status: 'failed',
          status_reason: error.message,
          status_code: error.code,
          accounts: involvedAccounts,
        };
      }

      appLogger.warn({ error }, 'parse-instruction-failed');
    } else {
      // Success - execute transaction
      const isPending = parsed.executeBy && isFutureDate(parsed.executeBy);

      // Build accounts maintaining input order
      const processedAccounts = [];
      data.accounts.forEach((account) => {
        if (account.id === validation.debitAccount.id) {
          processedAccounts.push({
            id: account.id,
            balance: isPending ? account.balance : account.balance - parsed.amount,
            balance_before: account.balance,
            currency: account.currency.toUpperCase(),
          });
        } else if (account.id === validation.creditAccount.id) {
          processedAccounts.push({
            id: account.id,
            balance: isPending ? account.balance : account.balance + parsed.amount,
            balance_before: account.balance,
            currency: account.currency.toUpperCase(),
          });
        }
      });

      response = {
        type: parsed.type,
        amount: parsed.amount,
        currency: parsed.currency,
        debit_account: parsed.debitAccount,
        credit_account: parsed.creditAccount,
        execute_by: parsed.executeBy,
        status: isPending ? 'pending' : 'successful',
        status_reason: isPending
          ? PaymentMessages.TRANSACTION_PENDING
          : PaymentMessages.TRANSACTION_SUCCESSFUL,
        status_code: isPending ? STATUS_CODES.PENDING : STATUS_CODES.SUCCESSFUL,
        accounts: processedAccounts,
      };

      appLogger.info({ status: response.status }, 'parse-instruction-success');
    }
  } catch (error) {
    // Log unexpected errors
    appLogger.errorX(error, 'parse-instruction-error');

    // Generic error response
    response = {
      type: null,
      amount: null,
      currency: null,
      debit_account: null,
      credit_account: null,
      execute_by: null,
      status: 'failed',
      status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
      status_code: STATUS_CODES.MALFORMED,
      accounts: [],
    };
  }

  // Single exit point (template requirement)
  return response;
}

// Export the service
module.exports = parseInstruction;
