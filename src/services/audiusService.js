import fetch from 'node-fetch';
import https from 'https';

class AudiusService {
  constructor() {
    this.baseUrl = null;
    // Create a custom HTTPS agent that ignores SSL certificate errors (for development only)
    this.agent = new https.Agent({
      rejectUnauthorized: false
    });
    this.initializeHost();
  }

  async initializeHost() {
    try {
      const response = await fetch('https://api.audius.co', {
        agent: this.agent
      });
      const { data } = await response.json();
      this.baseUrl = data[0];
      console.log('Initialized Audius host:', this.baseUrl);
    } catch (error) {
      console.error('Failed to initialize Audius host:', error);
      throw error;
    }
  }

  async ensureHost() {
    if (!this.baseUrl) {
      await this.initializeHost();
    }
    return this.baseUrl;
  }

  async search(query, type = 'tracks', limit = 50, offset = 0) {
    const baseUrl = await this.ensureHost();
    try {
      // Ensure proper encoding of query parameters
      const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 100);
      const safeOffset = Math.max(parseInt(offset) || 0, 0);
      
      // Use the tracks/search endpoint directly as it's more reliable
      const url = new URL(`${baseUrl}/v1/tracks/search`);
      url.searchParams.append('query', query);
      url.searchParams.append('limit', safeLimit.toString());
      url.searchParams.append('offset', safeOffset.toString());
      url.searchParams.append('app_name', 'StreamTunes');
      
      console.log(`Searching tracks from: ${url.toString()} (offset: ${safeOffset}, limit: ${safeLimit})`);
      const response = await fetch(url.toString(), { agent: this.agent });
      
      if (!response.ok) {
        console.error(`Search API error: ${response.status}`);
        // Try the trending endpoint as a fallback for genre searches
        if (query.match(/^(pop|hip-hop|rock|electronic|r&b|country|jazz|classical)$/i)) {
          const trendingUrl = new URL(`${baseUrl}/v1/tracks/trending`);
          trendingUrl.searchParams.append('limit', safeLimit.toString());
          trendingUrl.searchParams.append('app_name', 'StreamTunes');
          
          console.log('Trying trending as fallback:', trendingUrl.toString());
          const trendingResponse = await fetch(trendingUrl.toString(), { agent: this.agent });
          
          if (trendingResponse.ok) {
            const trendingData = await trendingResponse.json();
            return trendingData?.data ? trendingData : { data: [] };
          }
        }
        return { data: [] };
      }
      
      const data = await response.json();
      
      // If we got less than the requested limit and it's a genre search,
      // try to supplement with trending tracks
      if (safeOffset === 0 && data?.data && data.data.length < safeLimit && 
          query.match(/^(pop|hip-hop|rock|electronic|r&b|country|jazz|classical)$/i)) {
        try {
          const trendingUrl = new URL(`${baseUrl}/v1/tracks/trending`);
          trendingUrl.searchParams.append('limit', safeLimit.toString());
          trendingUrl.searchParams.append('app_name', 'StreamTunes');
          trendingUrl.searchParams.append('genre', query);
          
          const trendingResponse = await fetch(trendingUrl.toString(), { agent: this.agent });
          if (trendingResponse.ok) {
            const trendingData = await trendingResponse.json();
            if (trendingData?.data) {
              // Combine search results with trending, removing duplicates
              const allTracks = [...data.data];
              trendingData.data.forEach(track => {
                if (!allTracks.some(t => t.id === track.id)) {
                  allTracks.push(track);
                }
              });
              return { data: allTracks.slice(0, safeLimit) };
            }
          }
        } catch (error) {
          console.error('Error fetching supplementary tracks:', error);
        }
      }
      
      return data?.data ? data : { data: [] };
    } catch (error) {
      console.error('Error searching tracks:', error);
      return { data: [] };
    }
  }

  async getTrack(trackId) {
    await this.ensureHost();
    const response = await fetch(`${this.baseUrl}/v1/tracks/${trackId}`, { agent: this.agent });
    return response.json();
  }

  async getStreamUrl(trackId) {
    await this.ensureHost();
    try {
      // First, get the track info to ensure it exists
      const trackResponse = await fetch(`${this.baseUrl}/v1/tracks/${trackId}`, { agent: this.agent });
      const trackData = await trackResponse.json();
      
      if (!trackData?.data) {
        throw new Error('Track not found');
      }

      // Return the stream URL directly
      const streamUrl = `${this.baseUrl}/v1/tracks/${trackId}/stream`;
      return { data: streamUrl };
    } catch (error) {
      console.error('Error getting stream URL:', error);
      throw error;
    }
  }

  async getUser(userId) {
    await this.ensureHost();
    const response = await fetch(`${this.baseUrl}/v1/users/${userId}`, { agent: this.agent });
    return response.json();
  }

  async getUserTracks(userId, limit = 10) {
    await this.ensureHost();
    const response = await fetch(
      `${this.baseUrl}/v1/users/${userId}/tracks?limit=${limit}`,
      { agent: this.agent }
    );
    return response.json();
  }

  async getTrending(time = 'week', limit = 10) {
    const baseUrl = await this.ensureHost();
    try {
      const safeLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
      const url = new URL(`${baseUrl}/v1/tracks/trending`);
      url.searchParams.append('limit', safeLimit.toString());
      url.searchParams.append('time', time);
      url.searchParams.append('app_name', 'StreamTunes');
      
      console.log('Fetching trending tracks from:', url.toString());
      const response = await fetch(url.toString(), { agent: this.agent });
      
      if (!response.ok) {
        throw new Error(`Audius API returned ${response.status}`);
      }
      
      const data = await response.json();
      return data?.data ? data : { data: [] };
    } catch (error) {
      console.error('Error fetching trending tracks:', error);
      return { data: [] };
    }
  }

  async getPopular(limit = 10) {
    const baseUrl = await this.ensureHost();
    try {
      const safeLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
      // Use trending endpoint with 'allTime' time range to get popular tracks
      const url = new URL(`${baseUrl}/v1/tracks/trending`);
      url.searchParams.append('limit', safeLimit.toString());
      url.searchParams.append('time', 'allTime');
      
      console.log('Fetching popular tracks from:', url.toString());
      const response = await fetch(url.toString(), { agent: this.agent });
      
      if (!response.ok) {
        throw new Error(`Audius API returned ${response.status}`);
      }
      
      const data = await response.json();
      if (data?.data) {
        // Sort by play count to get truly popular tracks
        const sortedTracks = [...data.data].sort((a, b) => b.play_count - a.play_count);
        return { data: sortedTracks };
      }
      return { data: [] };
    } catch (error) {
      console.error('Error fetching popular tracks:', error);
      return { data: [] };
    }
  }

  async getRecentTracks(limit = 10) {
    const baseUrl = await this.ensureHost();
    try {
      const safeLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
      // Use search with empty query but sort by newest
      const url = new URL(`${baseUrl}/v1/tracks/search`);
      url.searchParams.append('limit', safeLimit.toString());
      url.searchParams.append('query', '');
      url.searchParams.append('sort', 'release_date');
      
      console.log('Fetching recent tracks from:', url.toString());
      const response = await fetch(url.toString(), { agent: this.agent });
      
      if (!response.ok) {
        throw new Error(`Audius API returned ${response.status}`);
      }
      
      const data = await response.json();
      return data?.data ? data : { data: [] };
    } catch (error) {
      console.error('Error fetching recent tracks:', error);
      return { data: [] };
    }
  }

  async getPlaylist(playlistId) {
    await this.ensureHost();
    const response = await fetch(`${this.baseUrl}/v1/playlists/${playlistId}`, { agent: this.agent });
    return response.json();
  }

  async getTrendingArtists(limit = 10) {
    const baseUrl = await this.ensureHost();
    try {
      const safeLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
      // Use search endpoint to get top artists since trending users endpoint is not reliable
      const url = new URL(`${baseUrl}/v1/users/search`);
      url.searchParams.append('limit', safeLimit.toString());
      url.searchParams.append('query', ''); // Empty query to get all artists
      url.searchParams.append('app_name', 'StreamTunes');
      url.searchParams.append('sort', 'follower_count'); // Sort by followers to get top artists
      
      console.log('Fetching trending artists from:', url.toString());
      const response = await fetch(url.toString(), { agent: this.agent });
      
      if (!response.ok) {
        throw new Error(`Audius API returned ${response.status}`);
      }
      
      const data = await response.json();
      return data?.data ? data : { data: [] };
    } catch (error) {
      console.error('Error fetching trending artists:', error);
      return { data: [] };
    }
  }

  async getTrendingPlaylists(limit = 10) {
    const baseUrl = await this.ensureHost();
    try {
      const safeLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
      // Use search endpoint to get top playlists since trending playlists endpoint is not reliable
      const url = new URL(`${baseUrl}/v1/playlists/search`);
      url.searchParams.append('limit', safeLimit.toString());
      url.searchParams.append('query', ''); // Empty query to get all playlists
      url.searchParams.append('app_name', 'StreamTunes');
      url.searchParams.append('sort', 'save_count'); // Sort by saves to get top playlists
      
      console.log('Fetching trending playlists from:', url.toString());
      const response = await fetch(url.toString(), { agent: this.agent });
      
      if (!response.ok) {
        throw new Error(`Audius API returned ${response.status}`);
      }
      
      const data = await response.json();
      return data?.data ? data : { data: [] };
    } catch (error) {
      console.error('Error fetching trending playlists:', error);
      return { data: [] };
    }
  }
}

export const audiusService = new AudiusService(); 