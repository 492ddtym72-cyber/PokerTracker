type PlayerAvatarProps = {
  name: string;
  photo?: string | null;
  className?: string;
};

export function playerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function PlayerAvatar({
  name,
  photo,
  className = "avatar",
}: PlayerAvatarProps) {
  return (
    <span
      className={`${className} player-photo${photo ? " has-photo" : ""}`}
      style={photo ? { backgroundImage: `url("${photo}")` } : undefined}
      aria-hidden="true"
    >
      {photo ? "" : playerInitials(name)}
    </span>
  );
}
