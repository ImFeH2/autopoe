import {
  BookText,
  MessagesSquare,
  Server,
  SlidersHorizontal,
  Terminal,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { OrganizationProvider } from "./app/organization";
import {
  navIdOf,
  type Route,
  RouterProvider,
  useNavigate,
  useRouter,
} from "./app/router";
import {
  Nav,
  NavItem,
  NavSection,
  Shell,
  Sidebar,
  SidebarFooter,
  SidebarOrg,
} from "./components/layout/shell";
import { Avatar, Badge, EmptyState, Spinner } from "./components/ui/index";
import { DiscussionsPage } from "./features/discussions/list";
import { ThreadPage } from "./features/discussions/thread";
import { DocumentPage } from "./features/library/document";
import { LibraryPage } from "./features/library/list";
import { MemberPage } from "./features/members/detail";
import { MembersPage } from "./features/members/list";
import {
  ExecutionPage,
  LimitsPage,
  ModelPage,
} from "./features/settings/index";
import { backend, type Member } from "./lib/backend";
import { plural } from "./lib/format";

type Loaded = {
  members: Member[];
  humanId: number;
  tokenLimit: number;
  unread: number;
};

function View({ route, tokenLimit }: { route: Route; tokenLimit: number }) {
  switch (route.name) {
    case "discussions":
      return <DiscussionsPage />;
    case "discussion":
      return <ThreadPage id={route.id} />;
    case "members":
      return <MembersPage tokenLimit={tokenLimit} />;
    case "member":
      return <MemberPage id={route.id} />;
    case "library":
      return <LibraryPage />;
    case "document":
      return <DocumentPage path={route.path} />;
    case "model":
      return <ModelPage />;
    case "execution":
      return <ExecutionPage />;
    case "limits":
      return <LimitsPage />;
  }
}

function Chrome({ loaded }: { loaded: Loaded }) {
  const { route } = useRouter();
  const navigate = useNavigate();
  const active = navIdOf(route);
  const agents = loaded.members.filter((member) => member.type === "agent");
  const running = agents.filter((member) => member.state === "running").length;

  return (
    <Shell
      sidebar={
        <Sidebar>
          <SidebarOrg
            name="Huddol"
            detail={`${plural(loaded.members.length, "Member")}, ${running} running`}
            mark={<Avatar name="Huddol" />}
          />
          <Nav label="Sections">
            <NavSection label="Organization">
              <NavItem
                icon={<MessagesSquare size={16} />}
                label="Discussions"
                active={active === "discussions"}
                badge={
                  loaded.unread > 0 ? (
                    <Badge tone="unread">{loaded.unread}</Badge>
                  ) : undefined
                }
                onSelect={() => navigate({ name: "discussions" })}
              />
              <NavItem
                icon={<Users size={16} />}
                label="Members"
                active={active === "members"}
                onSelect={() => navigate({ name: "members" })}
              />
              <NavItem
                icon={<BookText size={16} />}
                label="Library"
                active={active === "library"}
                onSelect={() => navigate({ name: "library" })}
              />
            </NavSection>
            <NavSection label="Settings">
              <NavItem
                icon={<Server size={16} />}
                label="Model"
                active={route.name === "model"}
                onSelect={() => navigate({ name: "model" })}
              />
              <NavItem
                icon={<Terminal size={16} />}
                label="Execution"
                active={route.name === "execution"}
                onSelect={() => navigate({ name: "execution" })}
              />
              <NavItem
                icon={<SlidersHorizontal size={16} />}
                label="Limits"
                active={active === "limits"}
                onSelect={() => navigate({ name: "limits" })}
              />
            </NavSection>
          </Nav>
          <SidebarFooter>
            <Avatar name="You" />
            <span className="sidebar-org-text">
              <span className="sidebar-org-name">You</span>
              <span className="sidebar-org-detail">Human Member</span>
            </span>
          </SidebarFooter>
        </Sidebar>
      }
    >
      <View route={route} tokenLimit={loaded.tokenLimit} />
    </Shell>
  );
}

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [organization, discussions] = await Promise.all([
      backend.organization(),
      backend.discussions(),
    ]);
    setLoaded({
      members: organization.members,
      humanId: organization.human_id,
      tokenLimit: organization.token_limit ?? 0,
      unread: discussions.reduce((total, item) => total + item.unread, 0),
    });
  }, []);

  useEffect(() => {
    backend
      .connect()
      .then(refresh)
      .catch((error) => setFailure(String(error)));
  }, [refresh]);

  useEffect(() => {
    return backend.onEvent((event) => {
      if (
        event.type.startsWith("member.") ||
        event.type.startsWith("turn.") ||
        event.type === "message.created" ||
        event.type === "mention.acked" ||
        event.type === "mention.revoked"
      ) {
        void refresh();
      }
    });
  }, [refresh]);

  if (failure) {
    return (
      <div className="boot">
        <EmptyState
          title="Cannot reach the Huddol backend"
          description={failure}
        />
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="boot">
        <Spinner label="Starting Huddol" />
        <p className="muted">Starting Huddol…</p>
      </div>
    );
  }

  return (
    <RouterProvider>
      <OrganizationProvider
        value={{
          members: loaded.members,
          humanId: loaded.humanId,
          refresh,
        }}
      >
        <Chrome loaded={loaded} />
      </OrganizationProvider>
    </RouterProvider>
  );
}
