import * as webhookTarget from './webhook-target';

describe('assertSafeWebhookTarget', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows public https targets', async () => {
    jest.spyOn(webhookTarget.webhookDns, 'lookupHostname').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    await expect(webhookTarget.assertSafeWebhookTarget('https://hooks.example.com/path')).resolves.toBeInstanceOf(URL);
  });

  it('rejects localhost hostnames', async () => {
    await expect(webhookTarget.assertSafeWebhookTarget('http://localhost:4000/hook')).rejects.toThrow(
      'Webhook URL must not target localhost or a local-network hostname.',
    );
  });

  it('rejects targets that resolve to private addresses', async () => {
    jest.spyOn(webhookTarget.webhookDns, 'lookupHostname').mockResolvedValue([{ address: '10.0.0.8', family: 4 }]);

    await expect(webhookTarget.assertSafeWebhookTarget('https://hooks.example.com/hook')).rejects.toThrow(
      'Webhook URL resolved to a loopback, private, or link-local address.',
    );
  });

  it('pins delivery to the checked DNS address', async () => {
    const lookup = jest
      .spyOn(webhookTarget.webhookDns, 'lookupHostname')
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(
      webhookTarget.postWebhookSafely('https://hooks.example.com/hook', '{}', {}),
    ).rejects.toThrow('Webhook URL resolved to a loopback, private, or link-local address.');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('revalidates redirect target hostnames', async () => {
    jest.spyOn(webhookTarget.webhookDns, 'lookupHostname').mockImplementation(async (hostname) => {
      if (hostname === 'public.example.com') {
        return [{ address: '127.0.0.1', family: 4 }];
      }
      return [{ address: '93.184.216.34', family: 4 }];
    });

    await expect(
      webhookTarget.postWebhookSafely('https://public.example.com/hook', '{}', {}),
    ).rejects.toThrow('Webhook URL resolved to a loopback, private, or link-local address.');
  });
});
