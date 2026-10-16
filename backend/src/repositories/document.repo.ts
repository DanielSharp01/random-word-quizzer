import { and, desc, eq, sql } from "drizzle-orm";
import { documentsTable } from "../db/schema";
import type { Executor } from "../providers/db";
import type { Block } from "../quiz/blanks";

const summary = {
  id: documentsTable.id,
  title: documentsTable.title,
  blockCount: sql<number>`jsonb_array_length(${documentsTable.blocks})`.mapWith(Number),
  createdAt: documentsTable.createdAt,
};

export class DocumentRepository {
  constructor(private db: Executor) {}

  async create(userId: string, title: string, blocks: Block[]) {
    const [document] = await this.db.insert(documentsTable).values({ userId, title, blocks }).returning(summary);
    return document!;
  }

  list(userId: string) {
    return this.db.select(summary).from(documentsTable).where(eq(documentsTable.userId, userId)).orderBy(desc(documentsTable.createdAt));
  }

  async find(userId: string, id: string) {
    const [document] = await this.db
      .select({ id: documentsTable.id, title: documentsTable.title, blocks: documentsTable.blocks })
      .from(documentsTable)
      .where(and(eq(documentsTable.id, id), eq(documentsTable.userId, userId)));
    return document;
  }

  async delete(userId: string, id: string) {
    const deleted = await this.db
      .delete(documentsTable)
      .where(and(eq(documentsTable.id, id), eq(documentsTable.userId, userId)))
      .returning({ id: documentsTable.id });
    return deleted.length > 0;
  }
}
