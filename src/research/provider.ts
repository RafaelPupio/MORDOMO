export type RetrievedPublicSource = {
  title: string;
  url: string;
  excerpt: string;
};

export class PublicResearchProviderError extends Error {
  constructor(readonly code: 'providerUnavailable' | 'retentionUnverified' | 'noUsefulContent' | 'unsafeUrl') {
    super(code);
    this.name = 'PublicResearchProviderError';
  }
}

export interface PublicResearchProvider {
  retrieveApprovedPage(url: URL): Promise<RetrievedPublicSource>;
}
