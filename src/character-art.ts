import type { Team } from "./fighters";

/**
 * Lightweight vector placeholders for the final pixel-art character sprites.
 * The shapes are original, themeable, and animated with CSS.
 */
export function characterArt(team: Team, variant: number): string {
  const isRed = team === "red";
  const head = isRed
    ? `<ellipse cx="79" cy="76" rx="27" ry="33" fill="#777e8e" stroke="#202437" stroke-width="5"/>
       <ellipse cx="46" cy="81" rx="22" ry="27" fill="#8f96a5" stroke="#202437" stroke-width="5"/>
       <path d="M95 78 Q114 96 105 132 Q98 146 88 135" fill="none" stroke="#777e8e" stroke-width="23" stroke-linecap="round"/>
       <path d="M95 78 Q114 96 105 132 Q98 146 88 135" fill="none" stroke="#202437" stroke-width="4" stroke-linecap="round"/>
       <path d="M94 99 L108 105 L101 116 Z" fill="#fff4d6" stroke="#202437" stroke-width="3"/>`
    : `<path d="M62 54 L48 10 Q44 2 36 10 L40 63 M94 54 L110 8 Q117 1 123 13 L110 70" fill="#8e756b" stroke="#202437" stroke-width="6" stroke-linejoin="round"/>
       <path d="M54 45 L45 17 M101 46 L113 16" stroke="#d49c9e" stroke-width="9" stroke-linecap="round"/>
       <path d="M46 69 Q51 42 81 43 Q111 45 115 77 L107 114 L58 116 Z" fill="#8e756b" stroke="#202437" stroke-width="5"/>
       <ellipse cx="83" cy="107" rx="30" ry="25" fill="#c6ad9d" stroke="#202437" stroke-width="5"/>
       <ellipse cx="71" cy="111" rx="4" ry="3" fill="#55433f"/><ellipse cx="94" cy="111" rx="4" ry="3" fill="#55433f"/>`;
  const accent = isRed ? "#c63b4e" : "#3164c5";
  const trim = variant === 0 ? "#f4ce77" : variant === 1 ? "#fff3e0" : "#a7b9d6";
  return `<svg class="character-art" viewBox="0 0 180 235" role="img" aria-label="${isRed ? "Elephant" : "Donkey"} boxer illustration" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="91" cy="221" rx="62" ry="9" fill="#000" opacity=".25"/>
    <g class="character-art__body">
      <path d="M60 175 L55 211 L78 211 L91 179 L105 211 L129 211 L119 166" fill="#252d48" stroke="#171d2f" stroke-width="6" stroke-linejoin="round"/>
      <path d="M51 133 Q91 111 131 136 L125 180 Q91 195 55 179 Z" fill="${accent}" stroke="#202437" stroke-width="6"/>
      <path d="M61 159 L122 159" stroke="${trim}" stroke-width="8"/>
      <path d="M51 139 L24 126 M130 140 L155 118" stroke="#777e8e" stroke-width="18" stroke-linecap="round"/>
      <g class="character-art__glove"><path d="M17 112 Q1 103 7 84 Q13 72 27 77 Q39 67 49 83 Q56 96 43 115 L28 129 Z" fill="${accent}" stroke="#202437" stroke-width="6"/><path d="M11 103 L40 115" stroke="#202437" stroke-width="4"/></g>
      <g class="character-art__rear-glove"><path d="M142 106 Q137 87 153 77 Q169 70 175 87 Q184 101 168 119 L150 131 Z" fill="${accent}" stroke="#202437" stroke-width="6"/></g>
      ${head}
      <ellipse cx="85" cy="76" rx="5" ry="6" fill="#fff"/><circle cx="87" cy="77" r="3" fill="#202437"/>
      <path d="M69 57 L85 62" stroke="#202437" stroke-width="5" stroke-linecap="round"/>
      <path d="M59 42 Q86 27 108 44" fill="none" stroke="${trim}" stroke-width="8" stroke-linecap="round"/>
    </g>
  </svg>`;
}
