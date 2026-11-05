import { createContext, useContext, useState, useSyncExternalStore } from 'react';
import { createDelivery } from '../lib/delivery';
import type { Person } from '../lib/types';
import type { ApiCall } from '../lib/useMessages';

const DeliveryContext = createContext<ReturnType<typeof createDelivery> | null>(null);

export function MessageDelivery({ api, user, children }: { api: ApiCall; user: Person; children: React.ReactNode }) {
  const [delivery] = useState(() => createDelivery(api, user, message => {
    window.dispatchEvent(new CustomEvent('hays:message-delivered', { detail: message }));
  }));
  return <DeliveryContext.Provider value={delivery}>{children}</DeliveryContext.Provider>;
}

export function useDelivery() {
  const delivery = useContext(DeliveryContext);
  if (!delivery) throw new Error('Message delivery requires a signed-in workspace.');
  const outgoing = useSyncExternalStore(delivery.subscribe, delivery.getSnapshot);
  return { ...delivery, outgoing };
}
