import type { Db } from '@binder/db'

/** A database handle or an open transaction on it. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type Executor = Db | Tx
