export interface FrontPageContent {
  title: string
  subtitle: string
  story: string
}

export const contentFields = ['title', 'subtitle', 'story'] as const
export const maxHtmlLength = 50_000
