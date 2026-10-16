import { OwnerApp } from "@/components/OwnerApp";

export default async function LocalBillPage({ params }: { params: Promise<{ localId: string }> }) {
  const { localId } = await params;
  return <OwnerApp localBillId={localId}/>;
}
