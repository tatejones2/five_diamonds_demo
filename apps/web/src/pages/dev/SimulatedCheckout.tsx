import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Alert, Button, Card, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';

/** DEVELOPMENT ONLY. Stands in for an external hosted checkout. No money moves. */
export default function SimulatedCheckout() {
  const [p] = useSearchParams();
  const ref = p.get('ref') ?? '';
  const m = useMutation({ mutationFn: (outcome: 'payment.succeeded' | 'payment.failed') => api('/dev/simulated-payment', { body: { providerReference: ref, outcome } }) });
  return (
    <div className="container-page max-w-lg py-12">
      <PageHeader eyebrow="Development only" title="Simulated checkout" />
      <Card className="space-y-4 p-6">
        <Alert tone="warn" title="This is not a real payment page.">It simulates a provider sending a signed server-to-server confirmation. Real checkout will redirect to the chosen provider.</Alert>
        <p className="text-sm">Registration <strong>{p.get('code')}</strong></p>
        {m.isSuccess ? <Alert tone="ok" title="Simulated callback sent. Return to your registration." /> : (
          <div className="flex gap-2">
            <Button onClick={() => m.mutate('payment.succeeded')} loading={m.isPending}>Simulate success</Button>
            <Button variant="secondary" onClick={() => m.mutate('payment.failed')}>Simulate failure</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
