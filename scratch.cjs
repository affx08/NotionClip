const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Replace Purples
code = code.replace(/text-purple-400/g, 'text-white')
           .replace(/text-purple-300/g, 'text-gray-300')
           .replace(/text-purple-500/g, 'text-white')
           .replace(/bg-purple-900\/30/g, 'bg-[#333]')
           .replace(/bg-purple-900\/20/g, 'bg-[#333]')
           .replace(/bg-purple-600\/10/g, 'bg-[#2a2a2a]')
           .replace(/bg-purple-600\/20/g, 'bg-[#333]')
           .replace(/bg-purple-600\/50/g, 'bg-gray-300')
           .replace(/bg-purple-600/g, 'bg-white text-black')
           .replace(/hover:bg-purple-500/g, 'hover:bg-gray-200')
           .replace(/shadow-purple-900\/20/g, 'shadow-white/10')
           .replace(/border-purple-500\/30/g, 'border-[#555]')
           .replace(/border-purple-500\/50/g, 'border-[#555]')
           .replace(/focus:border-purple-500/g, 'focus:border-[#555]')
           .replace(/focus:ring-purple-500/g, 'focus:ring-[#555]');

// Replace Blues
code = code.replace(/text-blue-400/g, 'text-white')
           .replace(/text-blue-500/g, 'text-white')
           .replace(/bg-blue-400/g, 'bg-white')
           .replace(/bg-blue-500/g, 'bg-white')
           .replace(/focus:ring-blue-500/g, 'focus:ring-white');

// Replace Greens
code = code.replace(/bg-green-500\/90/g, 'bg-[#252525] border border-[#444] text-white')
           .replace(/bg-green-600/g, 'bg-white text-black')
           .replace(/bg-green-500/g, 'bg-white text-black')
           .replace(/hover:bg-green-500/g, 'hover:bg-gray-200')
           .replace(/hover:bg-green-400/g, 'hover:bg-gray-200');

// Replace Reds
code = code.replace(/text-red-400/g, 'text-white')
           .replace(/bg-red-900\/30/g, 'bg-[#2a2a2a]')
           .replace(/hover:bg-red-900\/50/g, 'hover:bg-[#444]')
           .replace(/border-red-900\/50/g, 'border-[#555]');

// Make checkboxes grayscale
code = code.replace(/text-blue-500 focus:ring-blue-500/g, 'text-black focus:ring-white');

// Change the "Movie Save" pill's sparkle from text-white to text-gray-400 or just keep it
code = code.replace(/<span className="text-white">✨<\/span>/g, '<span>✨</span>');

fs.writeFileSync('src/App.tsx', code);
console.log("Colors replaced successfully.");
