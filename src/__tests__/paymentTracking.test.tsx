// @vitest-environment happy-dom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySession } from "../lib/billState";

const mocks = vi.hoisted(() => ({ select: vi.fn(), submit: vi.fn(), confirm: vi.fn(), start: vi.fn() }));
vi.mock("../hooks/sharedBillAdapter", () => ({
  selectSharedPaymentActor: mocks.select,
  submitSharedPayment: mocks.submit,
  confirmSharedPayment: mocks.confirm,
  startPaymentTracking: mocks.start,
}));
import { PaymentTracking } from "../components/PaymentTracking";

function session() {
  return {
    ...emptySession(), closedAt: "2026-10-17T00:00:00Z",
    participants: [{ id: "a", name: "A", promptPay: "" }, { id: "b", name: "B", promptPay: "" }],
    payments: [{ key: "a-b", fromParticipantId: "a", toParticipantId: "b", amount: 100,
      status: "pending" as const, proofKind: "" as const, submittedAt: "", confirmedAt: "" }],
  };
}

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

describe("payment actor selection", () => {
  it("waits for actor selection before allowing a claim and does not reselect on callback changes", async () => {
    const bill = session();
    let resolve!: (value: typeof bill) => void;
    mocks.select.mockReturnValue(new Promise((done) => { resolve = done; }));
    const onSession = vi.fn();
    const props = { billId: "bill", session: bill, selectedParticipantId: "a", owner: false, onSession };
    const view = render(createElement(PaymentTracking, props));
    expect((screen.getByRole("button", { name: "แจ้งว่าจ่ายเงินสด" }) as HTMLButtonElement).disabled).toBe(true);
    const latestCallback = vi.fn();
    view.rerender(createElement(PaymentTracking, { ...props, onSession: latestCallback }));
    await act(async () => { resolve(bill); });
    expect(onSession).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledWith(bill);
    expect(mocks.select).toHaveBeenCalledTimes(1);
    mocks.submit.mockResolvedValue(bill);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "แจ้งว่าจ่ายเงินสด" })); });
    expect(mocks.submit).toHaveBeenCalledWith("bill", "a-b", "cash");
  });

  it("ignores an old selection result after the selected participant changes", async () => {
    const bill = session();
    const pending: ((value: typeof bill) => void)[] = [];
    mocks.select.mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
    const onSession = vi.fn();
    const props = { billId: "bill", session: bill, selectedParticipantId: "a", owner: false, onSession };
    const view = render(createElement(PaymentTracking, props));
    view.rerender(createElement(PaymentTracking, { ...props, selectedParticipantId: "b" }));
    await act(async () => { pending[0](bill); });
    expect(onSession).not.toHaveBeenCalled();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("b");
    await act(async () => { pending[1](bill); });
    expect(onSession).toHaveBeenCalledTimes(1);
  });

  it("shows a selection error and keeps payment actions disabled", async () => {
    mocks.select.mockRejectedValue(new Error("offline"));
    await act(async () => {
      render(createElement(PaymentTracking, { billId: "bill", session: session(), selectedParticipantId: "a", owner: false, onSession: vi.fn() }));
    });
    expect(screen.getByText("เลือกชื่อสำหรับติดตามการจ่ายไม่สำเร็จ")).toBeTruthy();
    expect((screen.getByRole("button", { name: "แจ้งว่าจ่ายเงินสด" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(false);
  });

  it("ignores selection completion after the bill changes or the view closes", async () => {
    const bill = session();
    const pending: ((value: typeof bill) => void)[] = [];
    mocks.select.mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
    const onSession = vi.fn();
    const props = { billId: "first", session: bill, selectedParticipantId: "a", owner: false, onSession };
    const view = render(createElement(PaymentTracking, props));
    view.rerender(createElement(PaymentTracking, { ...props, billId: "second" }));
    await act(async () => { pending[0](bill); });
    expect(onSession).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => { pending[1](bill); });
    expect(onSession).not.toHaveBeenCalled();
  });

  it("does not select an actor for a read-only owner or an open bill", () => {
    const props = { billId: "bill", session: session(), selectedParticipantId: "a", owner: true, onSession: vi.fn() };
    const view = render(createElement(PaymentTracking, props));
    expect(mocks.select).not.toHaveBeenCalled();
    view.rerender(createElement(PaymentTracking, { ...props, owner: false, session: { ...session(), closedAt: "" } }));
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
