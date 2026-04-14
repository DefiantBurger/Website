type InteractionState = {
  sessionStartedAt: string;
  previousRoute: string | null;
  currentRoute: string | null;
  routeVisitCounts: Record<string, number>;
  projectViews: Record<string, number>;
};

const state: InteractionState = {
  sessionStartedAt: new Date().toISOString(),
  previousRoute: null,
  currentRoute: null,
  routeVisitCounts: {},
  projectViews: {}
};

export function recordRouteVisit(route: string): void {
  if (state.currentRoute !== route) {
    state.previousRoute = state.currentRoute;
  }
  state.currentRoute = route;
  state.routeVisitCounts[route] = (state.routeVisitCounts[route] ?? 0) + 1;
}

export function recordProjectView(slug: string): void {
  if (!slug) {
    return;
  }
  state.projectViews[slug] = (state.projectViews[slug] ?? 0) + 1;
}

export function getInteractionSnapshot() {
  return {
    sessionStartedAt: state.sessionStartedAt,
    previousRoute: state.previousRoute,
    currentRoute: state.currentRoute,
    routeVisitCounts: { ...state.routeVisitCounts },
    projectViews: { ...state.projectViews }
  };
}
