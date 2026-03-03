import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

export async function POST(request: Request): Promise<Response> {
  try {
    // Optional JSON body: { repo?: { owner: string; name: string } }
    let repo: { owner: string; name: string } | null = null
    const contentType = request.headers.get("content-type") ?? ""
    if (contentType.includes("application/json")) {
      try {
        const body = (await request.json()) as unknown
        if (
          body &&
          typeof body === "object" &&
          "repo" in body &&
          body.repo &&
          typeof (body as any).repo.owner === "string" &&
          typeof (body as any).repo.name === "string"
        ) {
          repo = {
            owner: (body as any).repo.owner,
            name: (body as any).repo.name,
          }
        }
      } catch {
        // Ignore JSON parse errors and continue without repo info
      }
    }

    const token = getAuthToken(request)
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Fetch GitHub user to validate token and get canonical GitHub id and login
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    })

    if (userResponse.status === 401) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (!userResponse.ok) {
      throw new Error(`GitHub user lookup failed: ${userResponse.status}`)
    }

    const { id: github_id, login: github_login } = await userResponse.json()

    if (typeof github_id !== "number" || !github_login) {
      throw new Error("Invalid GitHub user response")
    }

    // Upsert user record and get user id
    const { data: user, error: userError } = await supabase
      .from("users")
      .upsert(
        { github_id, github_login, last_active_at: new Date().toISOString() },
        { onConflict: "github_id" },
      )
      .select("id")
      .single()

    if (userError) {
      throw userError
    }

    // If we know which repo the user opened, upsert it into repositories
    if (repo) {
      const github_full_name = `${repo.owner}/${repo.name}`
      const { error: repoError } = await supabase
        .from("repositories")
        .upsert(
          {
            user_id: user.id,
            github_full_name,
            github_repo_name: repo.name,
            github_owner_login: repo.owner,
          },
          // Ensure we don't create duplicates per user/repo
          { onConflict: "user_id,github_full_name" },
        )

      if (repoError) {
        throw repoError
      }
    }

    // Log the `opened_app` event
    const userAgent = request.headers.get("user-agent")
    const { error: activityError } = await supabase
      .from("activity")
      .insert({ user_id: user.id, type: "opened_app", user_agent: userAgent })

    if (activityError) {
      throw activityError
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("Failed to log user:", error)
    return new Response(JSON.stringify({ error: "Failed to log user" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}

function getAuthToken(request: Request): string {
  const authHeader = request.headers.get("authorization") ?? ""
  if (!authHeader) return ""
  const [scheme, ...rest] = authHeader.split(" ")
  if (!scheme) return ""
  const normalizedScheme = scheme.toLowerCase()
  if (normalizedScheme !== "bearer" && normalizedScheme !== "token") return ""
  return rest.join(" ").trim()
}
