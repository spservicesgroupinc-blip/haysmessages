export interface Person { email: string; name: string; role: 'admin' | 'member' }
export interface Session { token: string; expiresAt: string; user: Person }
export interface Conversation { id: string; name: string; description: string; kind: 'channel' | 'group' | 'dm'; members: string[]; createdBy: string; createdAt: string; lastActivity: string; unread: number }
export interface Message { id: string; conversationId: string; authorEmail: string; authorName: string; body: string; createdAt: string; updatedAt: string; deleted: boolean; parentId: string; reactions: Record<string, string[]>; clientId: string }
export interface Bootstrap { user: Person; people: Person[]; conversations: Conversation[] }
export interface RegistrationInfo { enabled: boolean; requiresInvite: boolean; minPasswordLength: number }

