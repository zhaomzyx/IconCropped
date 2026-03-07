const fs = require("fs");
const { Config, LLMClient } = require("coze-coding-dev-sdk");

async function main() {
  const imagePath =
    "C:/Users/83693/AppData/Roaming/Code/User/workspaceStorage/vscode-chat-images/image-1772910783351.png";

  const imageBuffer = fs.readFileSync(imagePath);
  const dataUri = `data:image/png;base64,${imageBuffer.toString("base64")}`;

  const client = new LLMClient(new Config());
  const response = await client.invoke(
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Please read the English title text in the image and return plain text only.",
          },
          {
            type: "image_url",
            image_url: {
              url: dataUri,
              detail: "high",
            },
          },
        ],
      },
    ],
    {
      model: "doubao-seed-1-6-vision-250815",
      temperature: 0.1,
    },
  );

  console.log(String(response.content || "").trim());
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
