export interface TripCardProps {
  "destination"?: string;
  "nights"?: number;
  "title"?: string;
}

export default function createTripCard(input?: TripCardProps, children?: readonly (Node | string | null | undefined)[]): HTMLElement | DocumentFragment;
