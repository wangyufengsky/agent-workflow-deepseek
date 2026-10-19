import {
  ROUTES,
  createRequestKey,
  type InteractionDetail,
  type InteractionListResponse,
  type InteractionResolveRequest,
  type InteractionResolveResponse,
  type InteractionResolveResult,
} from '@agent-workflow/shared';
import { apiGet, apiPost } from '../../api/client.ts';

/** Interaction read models and the one write command exposed by W3-2. */
export async function fetchInteractions(): Promise<InteractionListResponse> {
  const response = await apiGet<InteractionListResponse>(ROUTES.interactions);
  return response.data;
}

export async function fetchInteraction(interactionId: string): Promise<InteractionDetail> {
  const response = await apiGet<InteractionDetail>(ROUTES.interaction(interactionId));
  return response.data;
}

export async function resolveInteraction(
  interactionId: string,
  answers: InteractionResolveRequest['answers'],
): Promise<InteractionResolveResponse> {
  const body: InteractionResolveRequest = {
    requestKey: createRequestKey(),
    confirmResolve: true,
    answers: [...answers],
  };
  const response = await apiPost<InteractionResolveResponse>(ROUTES.interactionResolve(interactionId), body);
  return response.data;
}

export type { InteractionDetail, InteractionListResponse, InteractionResolveResult };
