import { describe, it, expect } from 'vitest';
import type { CocCwlWar, CocWarMember, CocWarAttack } from '@/integrations/clashOfClans/client';

// Mock war data helpers
function createMockWar(
  clanTag: string,
  clanName: string,
  opponentTag: string,
  opponentName: string,
  endTime?: string
): CocCwlWar {
  return {
    state: 'warEnded',
    teamSize: 15,
    attacksPerMember: 1,
    startTime: '2025-12-01T00:00:00.000Z',
    endTime: endTime || '2025-12-01T23:59:59.000Z',
    clan: {
      tag: clanTag,
      name: clanName,
      attacks: 15,
      stars: 45,
      destructionPercentage: 100,
      members: []
    },
    opponent: {
      tag: opponentTag,
      name: opponentName,
      attacks: 15,
      stars: 45,
      destructionPercentage: 100,
      members: []
    }
  };
}

function createMockMember(tag: string, name: string, mapPosition: number, attacks: CocWarAttack[] = []): CocWarMember {
  return {
    tag,
    name,
    townhallLevel: 15,
    mapPosition,
    attacks
  };
}

function createMockAttack(defenderTag: string, stars: number): CocWarAttack {
  return {
    order: 1,
    attackerTag: 'test',
    defenderTag,
    stars,
    duration: 180,
    destructionPercentage: stars * 33
  };
}

describe('CWL Bonus Medals - War Indexing', () => {
  const clanTag = '#TEST123';
  const clanName = 'Test Clan';

  it('should correctly assign war indices when loading from cache', () => {
    // Simulate cached wars with day numbers 1-7
    const cachedWars = new Map<number, CocCwlWar>();

    // Create 7 wars with different opponents
    const opponents = [
      'Opponent 1',
      'Opponent 2',
      'Opponent 3',
      'Opponent 4',
      'Opponent 5',
      'Opponent 6',
      'Opponent 7'
    ];

    for (let i = 0; i < 7; i++) {
      const day = i + 1; // Day numbers are 1-7
      const war = createMockWar(clanTag, clanName, `#OPP${i}`, opponents[i]);
      cachedWars.set(day, war);
    }

    // Simulate the loading logic
    const sortedDays = Array.from(cachedWars.keys()).sort((a, b) => a - b);
    const wars: Array<{ war: CocCwlWar; index: number; opponentName: string }> = [];

    for (const day of sortedDays) {
      const war = cachedWars.get(day)!;
      const isClanSide = war.clan?.tag === clanTag;
      const opponentName = isClanSide ? war.opponent?.name || 'Unknown' : war.clan?.name || 'Unknown';
      wars.push({ war, index: day - 1, opponentName });
    }

    // Verify each war has correct index and opponent
    expect(wars.length).toBe(7);
    wars.forEach((w, i) => {
      expect(w.index).toBe(i);
      expect(w.opponentName).toBe(opponents[i]);
    });
  });

  it('should correctly assign opponent names when clan is on opponent side', () => {
    // Test case: our clan is on the opponent side (like in day1.json)
    const war = createMockWar('#OPP1', 'Opponent 1', clanTag, clanName);
    const isClanSide = war.clan?.tag === clanTag;
    const opponentName = isClanSide ? war.opponent?.name || 'Unknown' : war.clan?.name || 'Unknown';

    // When our clan is on opponent side, we should get the clan name as opponent
    expect(isClanSide).toBe(false);
    expect(opponentName).toBe('Opponent 1');
  });

  it('should correctly assign opponent names based on clan side', () => {
    // Test when our clan is on the 'clan' side
    const war1 = createMockWar(clanTag, clanName, '#OPP1', 'Opponent 1');
    const isClanSide1 = war1.clan?.tag === clanTag;
    const opponentName1 = isClanSide1 ? war1.opponent?.name || 'Unknown' : war1.clan?.name || 'Unknown';
    expect(opponentName1).toBe('Opponent 1');

    // Test when our clan is on the 'opponent' side (shouldn't happen in CWL, but test anyway)
    const war2 = createMockWar('#OPP2', 'Opponent 2', clanTag, clanName);
    const isClanSide2 = war2.clan?.tag === clanTag;
    const opponentName2 = isClanSide2 ? war2.opponent?.name || 'Unknown' : war2.clan?.name || 'Unknown';
    expect(opponentName2).toBe('Opponent 2');
  });

  it('should preserve war order when processing attacks', () => {
    // Create wars with attacks
    const wars: Array<{ war: CocCwlWar; index: number; opponentName: string }> = [];
    const opponents = ['War 1', 'War 2', 'War 3'];

    for (let i = 0; i < 3; i++) {
      const war = createMockWar(clanTag, clanName, `#OPP${i}`, opponents[i]);
      const member = createMockMember('#MEMBER1', 'Member 1', 1, [createMockAttack('#OPP1', 3)]);
      war.clan.members = [member];
      war.opponent.members = [createMockMember('#OPP1', 'Opponent 1', 1)];

      const isClanSide = war.clan?.tag === clanTag;
      const opponentName = isClanSide ? war.opponent?.name || 'Unknown' : war.clan?.name || 'Unknown';
      wars.push({ war, index: i, opponentName });
    }

    // Simulate processing attacks
    const attackDetails: Array<{
      warIndex: number;
      opponentName: string;
      stars: number;
    }> = [];

    for (const { war, index, opponentName } of wars) {
      const isClanSide = war.clan?.tag === clanTag;
      const ourSide = isClanSide ? war.clan : war.opponent;

      if (ourSide?.members) {
        for (const member of ourSide.members) {
          if (member.attacks) {
            for (const attack of member.attacks) {
              attackDetails.push({
                warIndex: index,
                opponentName,
                stars: attack.stars || 0
              });
            }
          }
        }
      }
    }

    // Verify attack details have correct war indices and opponent names
    expect(attackDetails.length).toBe(3);
    attackDetails.forEach((detail, i) => {
      expect(detail.warIndex).toBe(i);
      expect(detail.opponentName).toBe(opponents[i]);
    });
  });
});
