import { HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function createHost() {
  const reply = {
    header: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  const request = { method: 'GET', url: '/api/v1/test' };
  return {
    reply,
    host: {
      switchToHttp: () => ({
        getResponse: () => reply,
        getRequest: () => request,
      }),
    },
  };
}

describe('AllExceptionsFilter', () => {
  it('maps unavailable database connections to a non-disclosing 503 response', () => {
    const { host, reply } = createHost();
    const error = Object.assign(new Error('postgresql://user:password@database/private'), {
      code: 'P1001',
    });

    new AllExceptionsFilter().catch(error, host);

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(reply.header).toHaveBeenCalledWith('retry-after', '1');
    expect(reply.send).toHaveBeenCalledWith({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'Service temporarily unavailable',
    });
    expect(JSON.stringify(reply.send.mock.calls)).not.toContain('password');
  });

  it.each([
    'PostgresError { code: "57P01", message: "terminating connection due to administrator command" }',
    'Error querying the database: FATAL: the database system is starting up',
    'Server has closed the connection',
  ])('maps transient unknown Prisma connector errors to 503: %s', (message) => {
    const { host, reply } = createHost();
    const error = Object.assign(new Error(message), {
      name: 'PrismaClientUnknownRequestError',
    });

    new AllExceptionsFilter().catch(error, host);

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(reply.send).toHaveBeenCalledWith({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'Service temporarily unavailable',
    });
  });

  it('does not hide unrelated unknown database errors as an outage', () => {
    const { host, reply } = createHost();
    const error = Object.assign(new Error('Invalid column returned by query'), {
      name: 'PrismaClientUnknownRequestError',
    });

    new AllExceptionsFilter().catch(error, host);

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(reply.send).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  });

  it('preserves an explicit service-unavailable contract', () => {
    const { host, reply } = createHost();

    new AllExceptionsFilter().catch(
      new ServiceUnavailableException('Request protection is temporarily unavailable'),
      host,
    );

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(reply.send).toHaveBeenCalledWith({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'Request protection is temporarily unavailable',
      error: 'Service Unavailable',
    });
  });
});
