export type RequestResult<T> =
  | {
      data: T;
      error: "";
    }
  | {
      data: null;
      error: string;
      latest?: T;
    };
