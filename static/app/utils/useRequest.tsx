import {useState} from 'react';
import * as Sentry from '@sentry/react';

import {Client} from 'sentry/api';
import parseLinkHeader from 'sentry/utils/parseLinkHeader';
import RequestError from 'sentry/utils/requestError/requestError';
import useApi from 'sentry/utils/useApi';

type State = {
  data: null | any;
  /**
   * This is state for when fetching data from API
   */
  loading: boolean;
  /**
   * The error that occurred if fetching failed
   */
  error: null | RequestError;
  /**
   * Indicates that results (from API) are paginated and there are more
   * that are not in the initial response.
   */
  hasMore: null | boolean;
  /**
   * The last query we searched. Used to validate the cursor
   */
  lastSearch: null | string;
  /**
   * Pagination
   */
  nextCursor?: null | string;
};

export type Result = {
  /**
   * This is an action provided to consumers for them to update the current
   * result set using a simple search query.
   *
   * Will always add new options into the store.
   */
  onSearch: (searchTerm: string) => Promise<any>;
  nextPage: () => Promise<void>;
  get: () => Promise<any>;
  post: (_) => Promise<any>;
  update: (_) => Promise<any>;
  del: () => Promise<any>;
} & State;

type Options = {
  /**
   * Number of items to return per page
   */
  limit?: number;
};

type FetchRequestOptions = {
  limit?: Options['limit'];
  cursor?: State['nextCursor'];
  search?: State['lastSearch'];
  lastSearch?: State['lastSearch'];
};

/**
 * Helper function to actually load items
 */
async function fetch(
  api: Client,
  url: string,
  {search, limit, lastSearch, cursor}: FetchRequestOptions = {}
) {
  const query: {
    query?: string;
    cursor?: typeof cursor;
    per_page?: number;
  } = {};

  if (search) {
    query.query = `${query.query ?? ''} ${search}`.trim();
  }

  const isSameSearch = lastSearch === search || (!lastSearch && !search);

  if (isSameSearch && cursor) {
    query.cursor = cursor;
  }

  if (limit !== undefined) {
    query.per_page = limit;
  }

  let hasMore: null | boolean = false;
  let nextCursor: null | string = null;
  const [data, , resp] = await api.requestPromise(url, {
    includeAllArgs: true,
    query,
  });

  const pageLinks = resp?.getResponseHeader('Link');
  if (pageLinks) {
    const paginationObject = parseLinkHeader(pageLinks);
    hasMore = paginationObject?.next?.results || paginationObject?.previous?.results;
    nextCursor = paginationObject?.next?.cursor;
  }

  return {results: data, hasMore, nextCursor};
}

function useRequest(url: string, {limit}: Options = {}) {
  const api = useApi();

  const [state, setState] = useState<State>({
    data: null,
    loading: false,
    hasMore: null,
    lastSearch: null,
    nextCursor: null,
    error: null,
  });

  async function get(cursor: string | null = null) {
    setState({...state, loading: true});
    try {
      const {results, hasMore, nextCursor} = await fetch(api, url, {
        limit,
        cursor,
      });
      setState({
        ...state,
        data: results,
        hasMore,
        loading: false,
        nextCursor,
      });
      return Promise.resolve(results);
    } catch (err) {
      Sentry.captureException(err);
      setState({...state, loading: false, error: err});
      return Promise.reject(err);
    }
  }

  async function handleSearch(search: string) {
    const {lastSearch} = state;
    const cursor = state.nextCursor;

    if (search === '') {
      // For empty search params, do a simple GET request
      return get();
    }

    setState({...state, loading: true});

    try {
      api.clear();
      const {results, hasMore, nextCursor} = await fetch(api, url, {
        search,
        limit,
        lastSearch,
        cursor,
      });

      setState({
        ...state,
        data: results,
        hasMore,
        loading: false,
        lastSearch: search,
        nextCursor,
      });
      return Promise.resolve(results);
    } catch (err) {
      Sentry.captureException(err);
      setState({...state, loading: false, error: err});
      return Promise.reject(err);
    }
  }

  async function createOrUpdate(data: any, method: 'POST' | 'PUT' = 'POST') {
    setState({...state, loading: true});
    try {
      const [results] = await api.requestPromise(url, {
        method,
        data,
      });
      setState({
        ...state,
        data: results,
        loading: false,
      });
      return Promise.resolve(results);
    } catch (err) {
      Sentry.captureException(err);
      setState({...state, loading: false, error: err});
      return Promise.reject(err);
    }
  }

  async function del() {
    setState({...state, loading: true});
    try {
      const [results] = await api.requestPromise(url, {
        method: 'DELETE',
      });
      setState({
        ...state,
        data: results,
        loading: false,
      });
      return Promise.resolve(results);
    } catch (err) {
      Sentry.captureException(err);
      setState({...state, loading: false, error: err});
      return Promise.reject(err);
    }
  }
  const result: Result = {
    data: state.data,
    loading: state.loading,
    error: state.error,
    hasMore: state.hasMore,
    nextCursor: state.nextCursor,
    lastSearch: state.lastSearch,
    onSearch: handleSearch,
    nextPage: state.hasMore ? () => get(state.nextCursor) : () => Promise.resolve(),
    get: () => get(),
    post: data => createOrUpdate(data),
    update: data => createOrUpdate(data, 'PUT'),
    del: () => del(),
  };

  return result;
}

export default useRequest;
