export interface Person { email: string; name: string; role: 'admin' | 'member' }
export interface Session { token: string; expiresAt: string; user: Person }
export interface Conversation { id: string; name: string; description: string; kind: 'channel' | 'group' | 'dm'; members: string[]; createdBy: string; createdAt: string; lastActivity: string; unread: number }
export interface PictureAttachment { id: string; name: string; mimeType: string; size: number }
export interface PreparedPicture { name: string; mimeType: string; size: number; base64: string; preview: string }
export interface Message { id: string; conversationId: string; authorEmail: string; authorName: string; body: string; createdAt: string; updatedAt: string; deleted: boolean; parentId: string; reactions: Record<string, string[]>; clientId: string; pending?: 'sending' | 'failed'; deliveryError?: string; attachment?: PictureAttachment | null; localPicture?: string; deliveryStage?: 'uploading' | 'sending' }
export interface Bootstrap { user: Person; people: Person[]; conversations: Conversation[] }

