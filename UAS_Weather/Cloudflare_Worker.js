export default {
  async fetch(request) {

    const url = new URL(request.url);
    const ids = url.searchParams.get("ids");

    if (!ids) {
      return new Response(
        JSON.stringify({
          error: "Missing airport identifier"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    try {

      const metarResponse = await fetch(
        `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}&format=json`,
        {
          headers: {
            "Accept": "application/json"
          }
        }
      );

      const data = await metarResponse.text();

      return new Response(data, {
        status: metarResponse.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });

    } catch (error) {

      return new Response(
        JSON.stringify({
          error: error.message
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );

    }
  }
};
