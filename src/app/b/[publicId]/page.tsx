import { FriendBillClient } from "@/components/FriendBillClient";

export default async function SharedBillPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  return <FriendBillClient publicId={publicId}/>;
}
